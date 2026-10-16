// Self-serve signup. The draft lives in Postgres until CooperadoraFactory.create
// deploys that cooperative's treasury. Budget lines are proposed on chain afterwards:
// only signers can call propose().
import { randomBytes } from "node:crypto";
import { and, eq, gt, like, ne, sql } from "drizzle-orm";
import { decodeEventLog, encodeFunctionData, keccak256, toHex, type Address, type Hex } from "viem";
import type { Db } from "@/db";
import { agentTxs, cooperadora, memberships, persons } from "@/db/schema";
import { cooperadoraFactoryAbi } from "@/lib/chain/factory-abi";
import { sendAgentTx } from "@/lib/chain/agent";
import { publicClient } from "@/lib/chain/clients";
import { required } from "@/lib/env";
import { SIGNER_ROLES, type Person } from "@/lib/orchestrator/people";
import type { CoopRow } from "@/lib/tenant";

export const SIGNER_ROLE_OPTIONS = ["presidente", "tesorero", "secretario", "revisor"] as const;
export type SignerRole = (typeof SIGNER_ROLE_OPTIONS)[number];

export type DraftLine = { slug: string; name: string; allocated: string; periodEnd: number };

export type DraftConfig = {
  threshold: number;
  perTxCap: string;
  vendorMonthlyCap: string;
  lines: DraftLine[];
};

const PHONE = /^\+[1-9]\d{6,14}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Treasury deployments the agent pays for in any 24 hours, across all signups. */
export const MAX_DEPLOYS_PER_DAY = 10;

export function parseCuit(raw: string): bigint | null {
  const digits = raw.replace(/\D/g, "");
  if (!/^\d{11}$/.test(digits)) return null;
  return BigInt(digits);
}

export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return slug || "line";
}

export function draftConfigHash(draft: DraftConfig): Hex {
  const canonical = JSON.stringify({
    threshold: draft.threshold,
    perTxCap: draft.perTxCap,
    vendorMonthlyCap: draft.vendorMonthlyCap,
    lines: [...draft.lines].sort((a, b) => a.slug.localeCompare(b.slug)),
  });
  return keccak256(toHex(canonical));
}

export function readDraft(row: CoopRow): DraftConfig {
  const d = row.draft as Partial<DraftConfig> | null;
  return {
    threshold: d?.threshold ?? row.threshold ?? 1,
    perTxCap: d?.perTxCap ?? row.perTxCap ?? "0",
    vendorMonthlyCap: d?.vendorMonthlyCap ?? row.vendorMonthlyCap ?? "0",
    lines: Array.isArray(d?.lines) ? d.lines : [],
  };
}

export async function createDraft(
  db: Db,
  input: { name: string; school: string; cuit: bigint; ruce?: string | null; organizerName: string; organizerPhone: string },
): Promise<{ id: number; setupToken: string }> {
  if (!PHONE.test(input.organizerPhone)) throw new Error("Phone must be in international format, like +5491112345678.");
  const setupToken = randomBytes(24).toString("base64url");
  const chainId = await publicClient().getChainId().catch(() => 0);
  const [row] = await db
    .insert(cooperadora)
    .values({
      name: input.name.trim(),
      school: input.school.trim(),
      cuit: input.cuit,
      ruce: input.ruce?.trim() || null,
      chainId,
      status: "draft",
      treasuryAddress: null,
      boxFactoryAddress: null,
      configHash: null,
      setupToken,
    })
    .returning({ id: cooperadora.id });
  const person = await upsertPerson(db, input.organizerName.trim(), input.organizerPhone);
  await db
    .insert(memberships)
    .values({ personId: person.id, cooperadoraId: row.id, roles: ["socio"] })
    .onConflictDoNothing();
  return { id: row.id, setupToken };
}

/**
 * Finds or creates the person for a phone. Roles go in memberships, never in persons.roles: that
 * column is the demo's padrón, and writing to it would give the person roles in the demo.
 */
async function upsertPerson(db: Db, name: string, phone: string): Promise<Person> {
  const [existing] = await db.select().from(persons).where(eq(persons.phone, phone));
  if (existing) {
    if (!existing.name && name) await db.update(persons).set({ name }).where(eq(persons.id, existing.id));
    return existing;
  }
  const [created] = await db.insert(persons).values({ name, phone, roles: [] }).returning();
  return created;
}

/**
 * Whether a phone already belongs to someone in another cooperative. Their signature (passkey
 * Safe) is theirs: a signup must not add it to a new treasury, or hand out a link to create it.
 */
async function belongsElsewhere(db: Db, phone: string, cooperadoraId: number): Promise<boolean> {
  const [existing] = await db.select().from(persons).where(eq(persons.phone, phone));
  if (!existing) return false;
  const rows = await db.select({ cooperadoraId: memberships.cooperadoraId }).from(memberships).where(eq(memberships.personId, existing.id));
  if (rows.some((r) => r.cooperadoraId !== cooperadoraId)) return true;
  // The demo's padrón, from before memberships.
  return rows.length === 0 && existing.roles.length > 0;
}

export async function loadOwned(db: Db, id: number, setupToken: string | undefined): Promise<CoopRow | null> {
  if (!setupToken) return null;
  const [row] = await db
    .select()
    .from(cooperadora)
    .where(and(eq(cooperadora.id, id), eq(cooperadora.setupToken, setupToken)));
  return row ?? null;
}

export async function inviteSigner(
  db: Db,
  coop: CoopRow,
  input: { name: string; phone: string; role: SignerRole },
): Promise<{ personId: number }> {
  if (!PHONE.test(input.phone)) throw new Error("Phone must be in international format, like +5491112345678.");
  if (!SIGNER_ROLE_OPTIONS.includes(input.role)) throw new Error("Pick a signer role.");
  if (await belongsElsewhere(db, input.phone, coop.id)) {
    throw new Error("That phone already belongs to someone in another co-op. Each signer needs their own phone here.");
  }
  if (coop.status !== "draft") throw new Error("This co-op is already live. Change its signers with a proposal.");
  const person = await upsertPerson(db, input.name.trim(), input.phone);
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.personId, person.id), eq(memberships.cooperadoraId, coop.id)));
  const roles = [...new Set([...(membership?.roles ?? []), "socio", input.role])];
  await db
    .insert(memberships)
    .values({ personId: person.id, cooperadoraId: coop.id, roles })
    .onConflictDoUpdate({ target: [memberships.personId, memberships.cooperadoraId], set: { roles } });
  return { personId: person.id };
}

export async function saveRules(db: Db, coop: CoopRow, draft: DraftConfig): Promise<void> {
  if (coop.status !== "draft") throw new Error("This co-op is already live. Change its rules with a proposal.");
  if (draft.threshold < 1) throw new Error("Threshold has to be at least 1.");
  if (draft.lines.length === 0) throw new Error("Add at least one budget line.");
  const slugs = new Set<string>();
  for (const line of draft.lines) {
    if (!line.slug || !line.name) throw new Error("Every line needs a name.");
    if (slugs.has(line.slug)) throw new Error(`Two lines are named “${line.name}”.`);
    slugs.add(line.slug);
    if (BigInt(line.allocated) <= BigInt(0)) throw new Error(`“${line.name}” needs an amount.`);
  }
  await db
    .update(cooperadora)
    .set({
      draft,
      threshold: draft.threshold,
      perTxCap: draft.perTxCap,
      vendorMonthlyCap: draft.vendorMonthlyCap,
      configHash: draftConfigHash(draft),
    })
    .where(eq(cooperadora.id, coop.id));
}

export type SignerRow = { person: Person; roles: string[] };

export async function signersOf(db: Db, cooperadoraId: number): Promise<SignerRow[]> {
  const rows = await db
    .select({ person: persons, roles: memberships.roles })
    .from(memberships)
    .innerJoin(persons, eq(persons.id, memberships.personId))
    .where(eq(memberships.cooperadoraId, cooperadoraId));
  return rows.filter((r) => r.roles.some((role) => (SIGNER_ROLES as readonly string[]).includes(role)));
}

export async function deployDraft(db: Db, coop: CoopRow): Promise<{ status: "deployed" | "dry-run"; treasury?: Address; boxFactory?: Address }> {
  if (coop.status === "active" && coop.treasuryAddress) {
    return { status: "deployed", treasury: coop.treasuryAddress as Address, boxFactory: coop.boxFactoryAddress as Address };
  }
  const draft = readDraft(coop);
  const signers = await signersOf(db, coop.id);
  if (signers.length === 0) throw new Error("Invite at least one signer.");
  if (draft.threshold > signers.length) throw new Error("The threshold can't be higher than the number of signers.");
  const missing = signers.filter((s) => !s.person.safeAddress);
  if (missing.length > 0) {
    throw new Error(`${missing.map((s) => s.person.name).join(", ")} still need to create their passkey.`);
  }
  // The platform's agent pays for every treasury it deploys, and anyone can sign up.
  const since = new Date(Date.now() - DAY_MS);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentTxs)
    .where(and(like(agentTxs.key, "factory:create:%"), ne(agentTxs.key, `factory:create:${coop.id}`), gt(agentTxs.createdAt, since)));
  if (n >= MAX_DEPLOYS_PER_DAY) throw new Error("Too many co-ops were set up today. Try again tomorrow.");
  const factory = required("FACTORY_ADDRESS") as Address;
  const configHash = (coop.configHash as Hex | null) ?? draftConfigHash(draft);
  const data = encodeFunctionData({
    abi: cooperadoraFactoryAbi,
    functionName: "create",
    args: [
      signers.map((s) => s.person.safeAddress as Address),
      BigInt(draft.threshold),
      BigInt(draft.perTxCap),
      BigInt(draft.vendorMonthlyCap),
      configHash,
    ],
  });
  const result = await sendAgentTx(
    { key: `factory:create:${coop.id}`, kind: "register", to: factory, data },
    { db },
  );
  if ("dryRun" in result) return { status: "dry-run" };

  let onchainId: number | undefined;
  let treasury: Address | undefined;
  let boxFactory: Address | undefined;
  for (const log of result.receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: cooperadoraFactoryAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "CooperadoraCreated") {
        onchainId = Number(ev.args.id);
        treasury = ev.args.treasury;
        boxFactory = ev.args.boxFactory;
      }
    } catch {
      // another contract
    }
  }
  if (!treasury || !boxFactory || onchainId == null) throw new Error("The factory did not emit CooperadoraCreated.");
  const chainId = await publicClient().getChainId();
  await db
    .update(cooperadora)
    .set({
      status: "active",
      treasuryAddress: treasury,
      boxFactoryAddress: boxFactory,
      onchainId,
      configHash,
      chainId,
      deployBlock: result.receipt.blockNumber,
    })
    .where(eq(cooperadora.id, coop.id));
  return { status: "deployed", treasury, boxFactory };
}

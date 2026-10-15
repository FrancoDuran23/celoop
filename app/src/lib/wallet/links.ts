// Sign links: the token in /firmar/*?t= and /proveedor?t= identifies the person. Server only.
//
// - `sign` links are single use: consumed when the operation they authorize is sent.
// - `enroll` and `vendor` links can be reused until they expire.
// - All of them expire (the bot sets expiresAt, 24 hours).
//
// `target` (jsonb) scopes a `sign` link:
//   { paymentId: "3" }    → approve / reject / executePayment of payment 3 (and pause)
//   { proposalId: "1" }   → approveProposal of proposal 1 (and pause)
//   { action: "propose" } → propose (and pause). A null target means the same.
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Address } from "viem";
import type { Db } from "@/db";
import { persons, signLinks } from "@/db/schema";
import { SIGN_LINK_TTL_MS } from "./constants";

export type LinkPurpose = "enroll" | "sign" | "vendor";

export type LinkTarget =
  | { paymentId: string }
  | { proposalId: string }
  | { action: "propose" }
  | null;

export type LinkError = "not_found" | "expired" | "used" | "wrong_purpose" | "wrong_target" | "wrong_person";

export type ResolvedLink = {
  token: string;
  purpose: LinkPurpose;
  target: LinkTarget;
  expiresAt: Date;
  usedAt: Date | null;
  person: { id: number; name: string; roles: string[]; safeAddress: Address | null };
};

export type LinkResult = { ok: true; link: ResolvedLink } | { ok: false; error: LinkError };

export async function createSignLink(
  db: Db,
  args: { personId: number; purpose: LinkPurpose; target?: LinkTarget; ttlMs?: number; now?: Date },
): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const now = args.now ?? new Date();
  await db.insert(signLinks).values({
    token,
    personId: args.personId,
    purpose: args.purpose,
    target: args.target ?? null,
    expiresAt: new Date(now.getTime() + (args.ttlMs ?? SIGN_LINK_TTL_MS)),
  });
  return token;
}

/**
 * Looks up a token and checks it for one of `purposes`. A used `sign` link fails with "used"
 * unless `allowUsed` (for reads after the operation was sent, e.g. polling its receipt).
 */
export async function resolveSignLink(
  db: Db,
  token: string | null | undefined,
  opts: { purposes: LinkPurpose[]; now?: Date; allowUsed?: boolean },
): Promise<LinkResult> {
  if (!token || token.length > 128) return { ok: false, error: "not_found" };
  const rows = await db
    .select({ link: signLinks, person: persons })
    .from(signLinks)
    .innerJoin(persons, eq(persons.id, signLinks.personId))
    .where(eq(signLinks.token, token))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, error: "not_found" };
  const purpose = row.link.purpose as LinkPurpose;
  if (!opts.purposes.includes(purpose)) return { ok: false, error: "wrong_purpose" };
  const now = opts.now ?? new Date();
  if (row.link.expiresAt.getTime() <= now.getTime()) return { ok: false, error: "expired" };
  if (purpose === "sign" && row.link.usedAt && !opts.allowUsed) return { ok: false, error: "used" };
  return {
    ok: true,
    link: {
      token,
      purpose,
      target: parseTarget(row.link.target),
      expiresAt: row.link.expiresAt,
      usedAt: row.link.usedAt,
      person: {
        id: row.person.id,
        name: row.person.name,
        roles: row.person.roles,
        safeAddress: (row.person.safeAddress as Address | null) ?? null,
      },
    },
  };
}

/**
 * Marks a `sign` link as used. Returns false if someone else used it first.
 * `enroll` and `vendor` links are reusable, so this is a no-op returning true for them.
 */
export async function consumeSignLink(db: Db, link: ResolvedLink, now = new Date()): Promise<boolean> {
  if (link.purpose !== "sign") return true;
  const updated = await db
    .update(signLinks)
    .set({ usedAt: now })
    .where(and(eq(signLinks.token, link.token), isNull(signLinks.usedAt)))
    .returning({ token: signLinks.token });
  return updated.length === 1;
}

/** Whether a link (already resolved) may act on payment/proposal `id`. */
export function linkAllows(link: ResolvedLink, what: "payment" | "proposal" | "propose", id?: bigint): boolean {
  if (link.purpose !== "sign") return false;
  const t = link.target;
  if (what === "propose") return t === null || ("action" in t && t.action === "propose");
  if (t === null || id === undefined) return false;
  if (what === "payment") return "paymentId" in t && BigInt(t.paymentId) === id;
  return "proposalId" in t && BigInt(t.proposalId) === id;
}

/** The Safe that signs has to be the link's person's Safe. */
export function linkOwnsSafe(link: ResolvedLink, safe: string): boolean {
  return !!link.person.safeAddress && link.person.safeAddress.toLowerCase() === safe.toLowerCase();
}

function parseTarget(raw: unknown): LinkTarget {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const asId = (v: unknown) => (typeof v === "string" || typeof v === "number") && /^\d+$/.test(String(v));
  if (asId(o.paymentId)) return { paymentId: String(o.paymentId) };
  if (asId(o.proposalId)) return { proposalId: String(o.proposalId) };
  if (o.action === "propose") return { action: "propose" };
  return null;
}

export function linkErrorMessage(error: LinkError): string {
  switch (error) {
    case "not_found":
      return "Este link no es válido. Revisá que esté completo o pedí uno nuevo en el chat de la cooperadora.";
    case "expired":
      return "Este link venció. Pedí uno nuevo en el chat de la cooperadora.";
    case "used":
      return "Este link ya se usó. Si tenés que firmar otra vez, pedí uno nuevo en el chat.";
    case "wrong_purpose":
      return "Este link no sirve para esta página.";
    case "wrong_target":
      return "Este link es para otra operación. Abrí el link que te mandamos para esta.";
    case "wrong_person":
      return "Este link es de otra persona. Pedí el tuyo en el chat de la cooperadora.";
  }
}

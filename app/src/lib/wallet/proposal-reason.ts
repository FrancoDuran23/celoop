// What the contract can't hold about a proposal, saved after the signer creates it. Server only.
//
// - MoveBudget: the motive (proposals.reasonText); the contract only has its keccak256.
// - SetBudget with a new line: the budget_lines row (lineId = keccak256(slug), name), written once
//   ProposalCreated is confirmed.
// - SetVendor: the legal name, kept as pending metadata in proposals.decoded.meta. The vendors row is
//   written by applyExecutedProposal once the chain says the proposal executed.
// Everything is checked against the transaction: the ProposalCreated event, its proposer (the link's
// Safe) and its data.
import { and, eq, sql } from "drizzle-orm";
import { getAddress, isAddressEqual, parseEventLogs, type Address, type Hex } from "viem";
import { z } from "zod";
import type { Db } from "@/db";
import { budgetLines, persons, proposals, vendors } from "@/db/schema";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { grantRole, VENDOR_ROLE } from "@/lib/orchestrator/people";
import { scopeId } from "@/lib/tenant";
import { resolveSignLink, linkOwnsSafe } from "./links";
import { SLUG_PATTERN, lineIdOf } from "./proposal-builder";
import { decodeProposal, proposalKindName, reasonHash } from "./proposals";
import type { ChainReader } from "./views";

export const proposalMetaSchema = z.object({
  token: z.string().min(1).max(128),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  reasonText: z.string().trim().min(1).max(500).optional(),
  newLine: z.object({ slug: z.string().regex(SLUG_PATTERN).max(40), name: z.string().trim().min(2).max(60) }).optional(),
  vendorLegalName: z.string().trim().min(2).max(200).optional(),
});
export type ProposalMetaInput = z.infer<typeof proposalMetaSchema>;

export type ReasonResult = { ok: true; proposalId: string } | { ok: false; message: string };

/** Metadata the page keeps until the proposal executes. Lives under proposals.decoded.meta. */
export type PendingMeta = { vendorLegalName?: string; newLine?: { slug: string; name: string } };

type Deps = { db: Db; chain: Pick<ChainReader, "receipt">; treasury: Address; now?: Date };

export async function recordProposal(input: unknown, deps: Deps): Promise<ReasonResult> {
  const parsed = proposalMetaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "some details are missing." };
  const { token, txHash, reasonText, newLine, vendorLegalName } = parsed.data;

  // The link was consumed when the proposal was sent, so a used link is fine here.
  const resolved = await resolveSignLink(deps.db, token, { purposes: ["sign"], now: deps.now, allowUsed: true });
  if (!resolved.ok) return { ok: false, message: "the link isn't valid." };
  const link = resolved.link;

  const receipt = await deps.chain.receipt(txHash as Hex);
  const event = parseEventLogs({ abi: treasuryPolicyAbi, eventName: "ProposalCreated", logs: receipt.logs }).find(
    (e) => isAddressEqual(e.address, deps.treasury) && linkOwnsSafe(link, e.args.proposer),
  );
  if (!event) return { ok: false, message: "we couldn't find the proposal in that operation." };

  const kind = proposalKindName(event.args.kind);
  const decoded = decodeProposal(kind, event.args.data);
  const meta: PendingMeta = {};
  const cooperadoraId = scopeId(link.cooperadoraId);
  let motive: string | null = null;

  if (decoded.kind === "MoveBudget") {
    if (!reasonText || decoded.reasonHash !== reasonHash(reasonText)) {
      return { ok: false, message: "the reason doesn't match the proposal." };
    }
    motive = reasonText;
  }
  if (newLine) {
    if (decoded.kind !== "SetBudget" || lineIdOf(newLine.slug).toLowerCase() !== decoded.lineId.toLowerCase()) {
      return { ok: false, message: "the new line doesn't match the proposal." };
    }
    meta.newLine = newLine;
    await deps.db
      .insert(budgetLines)
      .values({ cooperadoraId, lineId: decoded.lineId, slug: newLine.slug, name: newLine.name })
      .onConflictDoNothing();
  }
  if (vendorLegalName) {
    if (decoded.kind !== "SetVendor") return { ok: false, message: "the legal name doesn't belong to this proposal." };
    meta.vendorLegalName = vendorLegalName;
  }

  const metaJson = JSON.stringify(meta);
  // The indexer writes the same row from the event; whoever comes second only adds what it lacks,
  // and our metadata goes under decoded.meta so it never replaces what the indexer decoded.
  await deps.db
    .insert(proposals)
    .values({
      cooperadoraId,
      proposalId: event.args.proposalId,
      kind,
      data: event.args.data,
      decoded: { meta },
      reasonText: motive,
      proposer: event.args.proposer,
      approvals: 1,
      createdTxHash: txHash,
    })
    .onConflictDoUpdate({
      target: [proposals.cooperadoraId, proposals.proposalId],
      set: {
        reasonText: sql`coalesce(${motive}, ${proposals.reasonText})`,
        decoded: sql`coalesce(${proposals.decoded}, '{}'::jsonb) || jsonb_build_object('meta', ${metaJson}::jsonb)`,
      },
    });
  return { ok: true, proposalId: event.args.proposalId.toString() };
}

/** Kept for the MoveBudget call sites: same as recordProposal with a motive. */
export async function recordProposalReason(input: { token: string; txHash: string; reasonText: string }, deps: Deps) {
  return recordProposal(input, deps);
}

/**
 * After a proposal executes on chain, mirrors what the app needs: for SetVendor, the vendors row
 * (legal name from the pending metadata, person linked by Safe address). Idempotent; a no-op for
 * proposals that haven't executed. The indexer can call it too when it sees ProposalExecuted.
 * `chain` must read the treasury of `cooperadoraId` (the demo when unset): proposal ids repeat.
 */
export async function applyExecutedProposal(
  db: Db,
  chain: Pick<ChainReader, "proposal">,
  proposalId: bigint,
  cooperadoraId?: number,
): Promise<{ applied: boolean }> {
  const coop = scopeId(cooperadoraId);
  const onchain = await chain.proposal(proposalId);
  if (!onchain || !onchain.executed) return { applied: false };
  const decoded = decodeProposal(onchain.kind, onchain.data);
  if (decoded.kind !== "SetVendor") return { applied: false };

  const rows = await db
    .select({ decoded: proposals.decoded })
    .from(proposals)
    .where(and(eq(proposals.cooperadoraId, coop), eq(proposals.proposalId, proposalId)))
    .limit(1);
  const meta = ((rows[0]?.decoded as { meta?: PendingMeta } | null)?.meta ?? {}) as PendingMeta;
  const address = getAddress(decoded.vendor);
  const person = (
    await db.select({ id: persons.id }).from(persons).where(sql`lower(${persons.safeAddress}) = ${address.toLowerCase()}`).limit(1)
  )[0];

  // Each cooperative enables its own vendors: the same CUIT can be a vendor of several of them.
  const inCoop = eq(vendors.cooperadoraId, coop);
  const byAddress = (await db.select().from(vendors).where(and(inCoop, sql`lower(${vendors.address}) = ${address.toLowerCase()}`)).limit(1))[0];
  const byCuit = (await db.select().from(vendors).where(and(inCoop, eq(vendors.cuit, decoded.cuit))).limit(1))[0];
  const existing = byAddress ?? byCuit;
  const legalName = meta.vendorLegalName ?? existing?.legalName ?? "Proveedor sin nombre";

  if (existing) {
    // A CUIT that moves to a new address keeps its row (and its history of invoices).
    if (byAddress && byCuit && byAddress.id !== byCuit.id) {
      console.error("SetVendor: address and CUIT belong to different vendor rows", { proposalId, address, cuit: decoded.cuit });
      return { applied: false };
    }
    await db
      .update(vendors)
      .set({ legalName, cuit: decoded.cuit, address, enabled: decoded.enabled, personId: person?.id ?? existing.personId })
      .where(eq(vendors.id, existing.id));
  } else {
    await db
      .insert(vendors)
      .values({ cooperadoraId: coop, legalName, cuit: decoded.cuit, address, enabled: decoded.enabled, personId: person?.id ?? null });
  }
  // A vendor paid into their own passkey Safe gets the vendor menu in this cooperative.
  if (person && decoded.enabled) await grantRole(db, person.id, coop, VENDOR_ROLE);
  return { applied: true };
}

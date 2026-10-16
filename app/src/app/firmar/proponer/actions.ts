"use server";
// Saves what the contract doesn't hold about a proposal the signer just created (motive, new budget
// line, vendor's legal name). Validates the link and the transaction before writing.
import { getDb } from "@/db";
import { applyExecutedProposal, recordProposal, type ProposalMetaInput, type ReasonResult } from "@/lib/wallet/proposal-reason";
import { resolveSignLink } from "@/lib/wallet/links";
import { linkScope } from "@/lib/wallet/server";

export async function saveProposalMeta(input: ProposalMetaInput): Promise<ReasonResult> {
  try {
    const db = getDb();
    // The treasury to check the transaction against is the link's cooperative's.
    const resolved = await resolveSignLink(db, input?.token, { purposes: ["sign"], allowUsed: true });
    if (!resolved.ok) return { ok: false, message: "the link isn't valid." };
    const scope = await linkScope(db, resolved.link);
    const result = await recordProposal(input, { db, chain: scope.chain, treasury: scope.treasury });
    // With a threshold of 1 the proposal already executed.
    if (result.ok) await applyExecutedProposal(db, scope.chain, BigInt(result.proposalId), scope.cooperadoraId);
    return result;
  } catch (error) {
    console.error("saveProposalMeta failed", error);
    return { ok: false, message: "we couldn't save the proposal details." };
  }
}

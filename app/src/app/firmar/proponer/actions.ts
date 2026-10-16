"use server";
// Saves what the contract doesn't hold about a proposal the signer just created (motive, new budget
// line, vendor's legal name). Validates the link and the transaction before writing.
import { getDb } from "@/db";
import { applyExecutedProposal, recordProposal, type ProposalMetaInput, type ReasonResult } from "@/lib/wallet/proposal-reason";
import { chainReader, treasuryAddress } from "@/lib/wallet/server";

export async function saveProposalMeta(input: ProposalMetaInput): Promise<ReasonResult> {
  try {
    const db = getDb();
    const result = await recordProposal(input, { db, chain: chainReader, treasury: await treasuryAddress() });
    // With a threshold of 1 the proposal already executed.
    if (result.ok) await applyExecutedProposal(db, chainReader, BigInt(result.proposalId));
    return result;
  } catch (error) {
    console.error("saveProposalMeta failed", error);
    return { ok: false, message: "we couldn't save the proposal details." };
  }
}

"use server";
// After a signer's approval: if that approval executed the proposal, mirror it (e.g. the vendors row).
import { getDb } from "@/db";
import { linkAllows, resolveSignLink } from "@/lib/wallet/links";
import { applyExecutedProposal } from "@/lib/wallet/proposal-reason";
import { linkScope } from "@/lib/wallet/server";

export async function syncProposal(input: { token: string; proposalId: string }): Promise<{ applied: boolean }> {
  try {
    if (!/^\d{1,20}$/.test(input.proposalId)) return { applied: false };
    const db = getDb();
    const resolved = await resolveSignLink(db, input.token, { purposes: ["sign"], allowUsed: true });
    if (!resolved.ok || !linkAllows(resolved.link, "proposal", BigInt(input.proposalId))) return { applied: false };
    const scope = await linkScope(db, resolved.link);
    return await applyExecutedProposal(db, scope.chain, BigInt(input.proposalId), scope.cooperadoraId);
  } catch (error) {
    console.error("syncProposal failed", error);
    return { applied: false };
  }
}

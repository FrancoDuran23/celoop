// Keeps `vendors` in step with executed SetVendor proposals, so a vendor shows up even when
// nobody reopens the proposal page after the last signature. Called after each indexer run.
import { and, eq, gt } from "drizzle-orm";
import type { Db } from "@/db";
import { proposals } from "@/db/schema";
import { applyExecutedProposal } from "./proposal-reason";
import type { ChainReader } from "./views";

/** Applies SetVendor proposals executed in the last `withinMs` (idempotent). */
export async function syncExecutedVendors(
  db: Db,
  chain: Pick<ChainReader, "proposal">,
  opts: { now?: Date; withinMs?: number } = {},
): Promise<{ applied: number }> {
  const since = new Date((opts.now ?? new Date()).getTime() - (opts.withinMs ?? 24 * 60 * 60 * 1000));
  const rows = await db
    .select({ proposalId: proposals.proposalId })
    .from(proposals)
    .where(and(eq(proposals.kind, "SetVendor"), eq(proposals.status, "executed"), gt(proposals.updatedAt, since)));
  let applied = 0;
  for (const row of rows) {
    if ((await applyExecutedProposal(db, chain, row.proposalId)).applied) applied++;
  }
  return { applied };
}

// Live treasury balance from the chain. The panel must keep working while the RPC is down or the
// treasury isn't configured, so every failure resolves to null and the caller falls back to the
// database sum.
import { getDb } from "@/db";
import { getTreasuryState } from "@/lib/chain/treasury";
import { resolveTreasury, scopeId } from "@/lib/tenant";

export async function loadLiveBalance(cooperadoraId?: number): Promise<bigint | null> {
  try {
    const db = getDb();
    const treasury = await resolveTreasury(db, null, scopeId(cooperadoraId));
    return (await getTreasuryState({ db, treasury })).balance;
  } catch {
    return null;
  }
}

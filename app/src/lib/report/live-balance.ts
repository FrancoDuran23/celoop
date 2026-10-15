// Live treasury balance from the chain. The panel must keep working while the RPC is down or the
// treasury isn't configured, so every failure resolves to null and the caller falls back to the
// database sum.
import { getTreasuryState } from "@/lib/chain/treasury";

export async function loadLiveBalance(): Promise<bigint | null> {
  try {
    return (await getTreasuryState()).balance;
  } catch {
    return null;
  }
}

// The auditor's only transaction: TreasuryPolicy.auditPayment, signed with AUDITOR_PRIVATE_KEY.
// It goes through the same idempotent, tagged send as the agent's (sendAgentTx), with its own
// account and therefore its own nonce.
import { decodeEventLog, encodeFunctionData, isAddressEqual, type Hex } from "viem";
import { treasuryPolicyAbi } from "./abi";
import { sendAgentTx, type AgentTxOptions } from "./agent";
import { resolveTreasury } from "@/lib/tenant";
import { auditorAccount } from "./clients";

export type AuditPaymentResult = {
  /** executed = the clearance paid it automatically; recorded = verdict stored, payment still pending. */
  status: "executed" | "recorded" | "dry-run";
  txHash?: Hex;
};

export async function auditPayment(
  args: { key: string; paymentId: bigint; cleared: boolean; reportHash: Hex },
  opts: AgentTxOptions = {},
): Promise<AuditPaymentResult> {
  const treasury = opts.treasury ?? (await resolveTreasury(opts.db));
  const data = encodeFunctionData({
    abi: treasuryPolicyAbi,
    functionName: "auditPayment",
    args: [args.paymentId, args.cleared, args.reportHash],
  });
  const result = await sendAgentTx(
    { key: args.key, kind: "audit", to: treasury, data },
    { ...opts, account: opts.account ?? auditorAccount() },
  );
  if ("dryRun" in result) return { status: "dry-run" };

  let executed = false;
  for (const log of result.receipt.logs) {
    if (!isAddressEqual(log.address, treasury)) continue;
    try {
      const ev = decodeEventLog({ abi: treasuryPolicyAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "PaymentExecuted" && ev.args.paymentId === args.paymentId) executed = true;
    } catch {
      // not one of ours
    }
  }
  return { status: executed ? "executed" : "recorded", txHash: result.txHash };
}

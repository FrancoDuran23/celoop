// Typed reads of the treasury, the box factory and wARS.
import { erc20Abi, type Address, type Hex } from "viem";
import { env } from "@/lib/env";
import { boxFactoryAbi, treasuryPolicyAbi } from "./abi";
import { addressFromEnv, publicClient } from "./clients";

export type BudgetState = { lineId: Hex; allocated: bigint; spent: bigint; periodEnd: bigint };

export type TreasuryState = {
  balance: bigint;
  paused: boolean;
  perTxCap: bigint;
  vendorMonthlyCap: bigint;
  signers: Address[];
  threshold: bigint;
  agent: Address;
  /** zeroAddress when the cooperadora has no auditor. */
  auditor: Address;
  budgets: BudgetState[];
};

export const PAYMENT_STATUS = ["none", "pending", "executed", "rejected"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export type OnchainPayment = {
  vendor: Address;
  amount: bigint;
  lineId: Hex;
  invoiceId: Hex;
  fileHash: Hex;
  status: PaymentStatus;
  approvals: bigint;
};

const treasury = () => ({ address: addressFromEnv("TREASURY_ADDRESS"), abi: treasuryPolicyAbi });

/** wARS address: WARS_ADDRESS if set, otherwise the treasury's token(). */
export async function warsAddress(): Promise<Address> {
  const fromEnv = env().WARS_ADDRESS;
  if (fromEnv) return fromEnv as Address;
  return publicClient().readContract({ ...treasury(), functionName: "token" });
}

export async function warsBalanceOf(address: Address): Promise<bigint> {
  return publicClient().readContract({
    address: await warsAddress(),
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  });
}

export async function getBudget(lineId: Hex): Promise<BudgetState & { exists: boolean }> {
  const b = await publicClient().readContract({ ...treasury(), functionName: "budget", args: [lineId] });
  return { lineId, allocated: b.allocated, spent: b.spent, periodEnd: BigInt(b.periodEnd), exists: b.exists };
}

export async function getTreasuryState(): Promise<TreasuryState> {
  const client = publicClient();
  const t = treasury();
  const [balance, paused, perTxCap, vendorMonthlyCap, signers, threshold, agent, auditor, lineIds] = await Promise.all([
    warsBalanceOf(t.address),
    client.readContract({ ...t, functionName: "paused" }),
    client.readContract({ ...t, functionName: "perTxCap" }),
    client.readContract({ ...t, functionName: "vendorMonthlyCap" }),
    client.readContract({ ...t, functionName: "signers" }),
    client.readContract({ ...t, functionName: "threshold" }),
    client.readContract({ ...t, functionName: "agent" }),
    client.readContract({ ...t, functionName: "auditor" }),
    client.readContract({ ...t, functionName: "budgetLines" }),
  ]);
  const budgets = await Promise.all(
    lineIds.map(async (lineId) => {
      const { allocated, spent, periodEnd } = await getBudget(lineId);
      return { lineId, allocated, spent, periodEnd };
    }),
  );
  return { balance, paused, perTxCap, vendorMonthlyCap, signers: [...signers], threshold, agent, auditor, budgets };
}

export async function getPayment(id: bigint): Promise<OnchainPayment> {
  const p = await publicClient().readContract({ ...treasury(), functionName: "payment", args: [id] });
  return {
    vendor: p.vendor,
    amount: p.amount,
    lineId: p.lineId,
    invoiceId: p.invoiceId,
    fileHash: p.fileHash,
    status: PAYMENT_STATUS[p.status] ?? "none",
    approvals: p.approvals,
  };
}

export const AUDIT_STATUS = ["none", "cleared", "flagged"] as const;
export type AuditStatus = (typeof AUDIT_STATUS)[number];

/** The auditor's verdict on a payment, straight from the contract. */
export async function getPaymentAudit(id: bigint): Promise<{ status: AuditStatus; reportHash: Hex }> {
  const [status, reportHash] = await publicClient().readContract({ ...treasury(), functionName: "paymentAudit", args: [id] });
  return { status: AUDIT_STATUS[status] ?? "none", reportHash };
}

export async function isInvoicePaid(invoiceId: Hex): Promise<boolean> {
  return publicClient().readContract({ ...treasury(), functionName: "invoicePaid", args: [invoiceId] });
}

export async function vendorSpentThisPeriod(vendor: Address): Promise<bigint> {
  return publicClient().readContract({ ...treasury(), functionName: "vendorSpentThisPeriod", args: [vendor] });
}

/** CREATE2 address of the deposit box for `ref`, deployed or not. */
export async function boxAddress(ref: Hex): Promise<Address> {
  return publicClient().readContract({
    address: addressFromEnv("BOX_FACTORY_ADDRESS"),
    abi: boxFactoryAbi,
    functionName: "boxAddress",
    args: [ref],
  });
}

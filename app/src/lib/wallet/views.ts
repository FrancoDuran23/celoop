// Data for the signing and vendor pages. Server only. Chain reads are injected (ChainReader) so the
// loaders can be tested with PGlite and fakes; production uses chainReader from ./server.
import { and, desc, eq, isNotNull, sql, type AnyColumn } from "drizzle-orm";
import type { Address, Hex, TransactionReceipt } from "viem";
import type { Db } from "@/db";
import { budgetIndex, budgetLines, invoices, payments, persons, proposals, vendors } from "@/db/schema";
import { decodeProposal, describeProposal, proposalKindName, type ProposalKindName } from "./proposals";

export type ChainReader = {
  payment(id: bigint): Promise<{ vendor: Address; amount: bigint; lineId: Hex; status: string; approvals: bigint }>;
  budget(lineId: Hex): Promise<{ allocated: bigint; spent: bigint; exists: boolean }>;
  threshold(): Promise<bigint>;
  paused(): Promise<boolean>;
  hasApproved(id: bigint, signer: Address): Promise<boolean>;
  /** null if the proposal doesn't exist. */
  proposal(id: bigint): Promise<{ kind: number; data: Hex; proposer: Address; executed: boolean; approvals: bigint } | null>;
  hasApprovedProposal(id: bigint, signer: Address): Promise<boolean>;
  caps(): Promise<{ perTxCap: bigint; vendorMonthlyCap: bigint }>;
  warsBalanceOf(address: Address): Promise<bigint>;
  receipt(txHash: Hex): Promise<TransactionReceipt>;
};

const lowerEq = (column: AnyColumn, value: string) => sql`lower(${column}) = ${value.toLowerCase()}`;

const INVOICE_TYPES: Record<number, string> = { 1: "Factura A", 6: "Factura B", 11: "Factura C" };

export function invoiceLabel(inv: { tipo: number | null; ptoVta: number | null; nro: bigint | null }): string | null {
  if (inv.ptoVta === null || inv.nro === null) return null;
  const kind = (inv.tipo !== null && INVOICE_TYPES[inv.tipo]) || "Comprobante";
  return `${kind} ${String(inv.ptoVta).padStart(5, "0")}-${String(inv.nro).padStart(8, "0")}`;
}

async function lineNames(db: Db): Promise<Map<string, string>> {
  const rows = await db.select().from(budgetLines);
  return new Map(rows.map((r) => [r.lineId.toLowerCase(), r.name]));
}

export type PaymentView = {
  paymentId: string;
  status: "pending" | "executed" | "rejected" | "none";
  vendorName: string;
  vendorAddress: Address;
  cuit: string | null;
  amount: string;
  lineName: string;
  invoiceUrl: string | null;
  invoiceLabel: string | null;
  approvals: number;
  threshold: number;
  /** Payment + already spent goes over what the line has. */
  overBudget: boolean;
  /** What is left in the line before this payment (may be negative). */
  lineAvailable: string;
  paused: boolean;
  alreadyApproved: boolean;
};

export async function loadPaymentView(db: Db, chain: ChainReader, paymentId: bigint, signer: Address | null): Promise<PaymentView | null> {
  const onchain = await chain.payment(paymentId);
  if (onchain.status === "none") return null;
  const [threshold, paused, budget, alreadyApproved, names, vendorRows, invoiceRows] = await Promise.all([
    chain.threshold(),
    chain.paused(),
    chain.budget(onchain.lineId),
    signer ? chain.hasApproved(paymentId, signer) : Promise.resolve(false),
    lineNames(db),
    db.select().from(vendors).where(lowerEq(vendors.address, onchain.vendor)).limit(1),
    db.select().from(invoices).where(eq(invoices.paymentId, paymentId)).limit(1),
  ]);
  const vendor = vendorRows[0];
  const invoice = invoiceRows[0];
  const available = budget.allocated - budget.spent;
  return {
    paymentId: paymentId.toString(),
    status: onchain.status as PaymentView["status"],
    vendorName: vendor?.legalName ?? "Proveedor sin nombre",
    vendorAddress: onchain.vendor,
    cuit: (vendor?.cuit ?? invoice?.cuit)?.toString() ?? null,
    amount: onchain.amount.toString(),
    lineName: names.get(onchain.lineId.toLowerCase()) ?? "Partida sin nombre",
    invoiceUrl: invoice?.fileUrl ?? null,
    invoiceLabel: invoice ? invoiceLabel(invoice) : null,
    approvals: Number(onchain.approvals),
    threshold: Number(threshold),
    overBudget: onchain.status === "pending" && onchain.amount > available,
    lineAvailable: available.toString(),
    paused,
    alreadyApproved,
  };
}

export type ProposalView = {
  proposalId: string;
  kind: ProposalKindName;
  summary: string;
  reasonMatches: boolean | null;
  status: "open" | "executed";
  approvals: number;
  threshold: number;
  paused: boolean;
  alreadyApproved: boolean;
};

/** The chain has the proposal itself; the database only adds its motive (proposals.reasonText). */
export async function loadProposalView(db: Db, chain: ChainReader, proposalId: bigint, signer: Address | null): Promise<ProposalView | null> {
  const onchain = await chain.proposal(proposalId);
  if (!onchain) return null;
  const [threshold, paused, names, vendorRows, rows, alreadyApproved] = await Promise.all([
    chain.threshold(),
    chain.paused(),
    lineNames(db),
    db.select({ address: vendors.address, legalName: vendors.legalName }).from(vendors),
    db.select({ reasonText: proposals.reasonText, decoded: proposals.decoded }).from(proposals).where(eq(proposals.proposalId, proposalId)).limit(1),
    signer ? chain.hasApprovedProposal(proposalId, signer) : Promise.resolve(false),
  ]);
  const vendorNames = new Map(vendorRows.map((v) => [v.address.toLowerCase(), v.legalName]));
  const decoded = decodeProposal(onchain.kind, onchain.data);
  // Names the proposer typed for a new line or vendor, until those rows exist.
  const meta = (rows[0]?.decoded as { meta?: { vendorLegalName?: string; newLine?: { name: string } } } | null)?.meta;
  const { summary, reasonMatches } = describeProposal(decoded, {
    lineName: (id) => names.get(id.toLowerCase()) ?? meta?.newLine?.name,
    vendorName: (a) => meta?.vendorLegalName ?? vendorNames.get(a.toLowerCase()),
    reasonText: rows[0]?.reasonText ?? null,
  });
  return {
    proposalId: proposalId.toString(),
    kind: proposalKindName(onchain.kind),
    summary,
    reasonMatches,
    status: onchain.executed ? "executed" : "open",
    approvals: Number(onchain.approvals),
    threshold: Number(threshold),
    paused,
    alreadyApproved,
  };
}

export type LineOption = { lineId: Hex; name: string; available: string | null };

export async function loadBudgetLines(db: Db): Promise<LineOption[]> {
  const rows = await db
    .select({ lineId: budgetLines.lineId, name: budgetLines.name, allocated: budgetIndex.allocated, spent: budgetIndex.spent })
    .from(budgetLines)
    .leftJoin(budgetIndex, eq(budgetIndex.lineId, budgetLines.lineId))
    .orderBy(budgetLines.name);
  return rows.map((r) => ({
    lineId: r.lineId as Hex,
    name: r.name,
    available: r.allocated !== null && r.spent !== null ? (BigInt(r.allocated) - BigInt(r.spent)).toString() : null,
  }));
}

export type VendorOption = { address: Address; legalName: string; cuit: string; enabled: boolean };
export type VendorPersonOption = { name: string; safeAddress: Address };

export type ProposeContext = {
  lines: LineOption[];
  vendors: VendorOption[];
  /** People with the proveedor role who already created their passkey Safe. */
  vendorPeople: VendorPersonOption[];
  caps: { perTxCap: string; vendorMonthlyCap: string };
  paused: boolean;
};

export async function loadProposeContext(db: Db, chain: ChainReader): Promise<ProposeContext> {
  const [lines, vendorRows, peopleRows, caps, paused] = await Promise.all([
    loadBudgetLines(db),
    db.select().from(vendors).orderBy(vendors.legalName),
    db
      .select({ name: persons.name, safeAddress: persons.safeAddress })
      .from(persons)
      .where(and(sql`'proveedor' = any(${persons.roles})`, isNotNull(persons.safeAddress)))
      .orderBy(persons.name),
    chain.caps(),
    chain.paused(),
  ]);
  return {
    lines,
    vendors: vendorRows.map((v) => ({ address: v.address as Address, legalName: v.legalName, cuit: v.cuit.toString(), enabled: v.enabled })),
    vendorPeople: peopleRows.map((p) => ({ name: p.name, safeAddress: p.safeAddress as Address })),
    caps: { perTxCap: caps.perTxCap.toString(), vendorMonthlyCap: caps.vendorMonthlyCap.toString() },
    paused,
  };
}

export type VendorPayment = { paymentId: string; amount: string; status: string; invoiceLabel: string | null; date: string | null };

export type VendorView = {
  legalName: string;
  address: Address;
  /** The vendor is paid into the person's passkey Safe, so the page can move the money. */
  canTransfer: boolean;
  balance: string;
  payments: VendorPayment[];
};

export async function loadVendorView(db: Db, chain: ChainReader, personId: number, safe: Address | null): Promise<VendorView | null> {
  const byPerson = await db.select().from(vendors).where(eq(vendors.personId, personId)).limit(1);
  const vendor = byPerson[0] ?? (safe ? (await db.select().from(vendors).where(lowerEq(vendors.address, safe)).limit(1))[0] : undefined);
  if (!vendor) return null;
  const address = vendor.address as Address;
  const [balance, rows] = await Promise.all([
    chain.warsBalanceOf(address),
    db
      .select({ payment: payments, invoice: invoices })
      .from(payments)
      .leftJoin(invoices, eq(invoices.paymentId, payments.paymentId))
      .where(lowerEq(payments.vendor, address))
      .orderBy(desc(payments.paymentId))
      .limit(50),
  ]);
  return {
    legalName: vendor.legalName,
    address,
    canTransfer: !!safe && safe.toLowerCase() === address.toLowerCase(),
    balance: balance.toString(),
    payments: rows.map(({ payment, invoice }) => ({
      paymentId: payment.paymentId.toString(),
      amount: payment.amount,
      status: payment.status,
      invoiceLabel: invoice ? invoiceLabel(invoice) : null,
      date: (payment.executedAt ?? payment.updatedAt)?.toISOString() ?? null,
    })),
  };
}

// Data for the public audit page (/auditoria/<paymentId>). Plain JSON, no bigint.
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { audits, cooperadora, invoices, payments, vendors } from "@/db/schema";
import { formatCuit, formatComprobante, invoiceTypeLabel } from "@/lib/report/format";
import type { Finding } from "./checks";

export type AuditView = {
  paymentId: string;
  chainId: number;
  verdict: "cleared" | "flagged";
  observations: Finding[];
  notes: Finding[];
  vendor: string;
  cuit: string | null;
  invoice: string | null;
  amount: string;
  /** What the index saw on chain: the verdict, its hash and transaction. Null until it is indexed. */
  onchain: { verdict: string; reportHash: string; txHash: string | null } | null;
  reportHash: string;
  /** The on-chain hash equals the hash of the stored report. Null when not on chain yet. */
  hashMatches: boolean | null;
  paymentStatus: string | null;
  checkedAt: string;
};

export async function loadAuditView(db: Db, paymentId: bigint, cooperadoraId?: number): Promise<AuditView | null> {
  const rows = await db
    .select()
    .from(audits)
    .where(and(eq(audits.paymentId, paymentId), cooperadoraId != null ? eq(audits.cooperadoraId, cooperadoraId) : undefined));
  if (rows.length !== 1) return null;
  const row = rows[0];
  const [coop] = await db.select({ chainId: cooperadora.chainId }).from(cooperadora).where(eq(cooperadora.id, row.cooperadoraId));
  const [pay] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.paymentId, paymentId), eq(payments.cooperadoraId, row.cooperadoraId)));
  const report = JSON.parse(row.reportJson) as { payment: { vendor: string; amount: string; invoiceId: string }; checkedAt: string };
  const [vendor] = await db
    .select()
    .from(vendors)
    .where(and(sql`lower(${vendors.address}) = ${report.payment.vendor.toLowerCase()}`, eq(vendors.cooperadoraId, row.cooperadoraId)));
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(sql`lower(${invoices.invoiceId}) = ${report.payment.invoiceId.toLowerCase()}`, eq(invoices.cooperadoraId, row.cooperadoraId)));
  const findings = row.findings as Finding[];
  const onchain = pay?.audit && pay.auditReportHash ? { verdict: pay.audit, reportHash: pay.auditReportHash, txHash: pay.auditTxHash } : null;
  return {
    paymentId: paymentId.toString(),
    chainId: coop?.chainId ?? 0,
    verdict: row.verdict === "flagged" ? "flagged" : "cleared",
    observations: findings.filter((f) => f.level === "observacion"),
    notes: findings.filter((f) => f.level === "nota"),
    vendor: vendor?.legalName ?? "Unregistered vendor",
    cuit: inv?.cuit ? formatCuit(inv.cuit) : vendor ? formatCuit(vendor.cuit) : null,
    invoice: inv ? `${invoiceTypeLabel(inv.tipo)} ${formatComprobante(inv.ptoVta, inv.nro)}` : null,
    amount: report.payment.amount,
    onchain,
    reportHash: row.reportHash,
    hashMatches: onchain ? onchain.reportHash.toLowerCase() === row.reportHash.toLowerCase() : null,
    paymentStatus: pay?.status ?? null,
    checkedAt: report.checkedAt,
  };
}

/** The exact stored text, so its keccak256 can be checked against the chain. */
export async function loadAuditJson(db: Db, paymentId: bigint, cooperadoraId?: number): Promise<string | null> {
  const rows = await db
    .select({ json: audits.reportJson })
    .from(audits)
    .where(and(eq(audits.paymentId, paymentId), cooperadoraId != null ? eq(audits.cooperadoraId, cooperadoraId) : undefined));
  return rows.length === 1 ? rows[0].json : null;
}

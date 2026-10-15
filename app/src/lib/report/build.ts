// buildReport: the monthly rendición, computed from the indexed tables. Deterministic: the
// same database always yields the same object (no "now", stable ordering).
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { budgetIndex, budgetLines, contributions, cooperadora, invoices, payments, vendors } from "@/db/schema";
import { executedChanges } from "./changes";
import {
  formatComprobante, formatCuit, isPeriod, periodLabel, periodRange, sumBase, tipoLabel,
} from "./format";
import type { ExpenseRow, IncomeConcept, IncomeRow, ReportData } from "./types";

const auditOf = (a: string | null): "cleared" | "flagged" | null => (a === "cleared" || a === "flagged" ? a : null);

const CONCEPTS: IncomeConcept[] = ["aportes_socios", "sin_identificar", "especie", "trabajo"];

export const SIGNATURE_SLOTS = [
  { role: "presidente", label: "Presidente/a" },
  { role: "tesorero", label: "Tesorero/a" },
  { role: "revisor", label: "Revisor/a de cuentas" },
];

function conceptOf(c: { kind: string; personId: number | null }): IncomeConcept {
  if (c.kind === "especie") return "especie";
  if (c.kind === "trabajo") return "trabajo";
  return c.personId === null ? "sin_identificar" : "aportes_socios";
}

export async function buildReport(db: Db, period: string): Promise<ReportData> {
  if (!isPeriod(period)) throw new Error(`Invalid period "${period}", expected YYYY-MM`);
  const { start, end } = periodRange(period);

  const [coop] = await db.select().from(cooperadora);
  if (!coop) throw new Error("Cooperadora is not configured");

  const lines = await db.select().from(budgetLines);
  const index = await db.select().from(budgetIndex);
  const indexById = new Map(index.map((i) => [i.lineId.toLowerCase(), i]));
  const lineById = new Map(lines.map((l) => [l.lineId.toLowerCase(), l]));

  // Balance: money only (dinero in, executed payments out). Especie and trabajo never move it.
  const allContributions = await db.select().from(contributions);
  const allPayments = await db.select().from(payments).where(eq(payments.status, "executed"));
  const isMoney = (c: { kind: string }) => c.kind === "dinero";
  const before = (d: Date | null) => d !== null && d < start;
  const opening =
    sumBase(allContributions.filter((c) => isMoney(c) && before(c.occurredAt)).map((c) => c.amount)) -
    sumBase(allPayments.filter((p) => before(p.executedAt)).map((p) => p.amount));

  // Income.
  const periodContributions = allContributions
    .filter((c) => c.occurredAt >= start && c.occurredAt < end)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id - b.id);
  const incomeRows: IncomeRow[] = periodContributions.map((c) => ({
    date: c.occurredAt.toISOString(),
    concept: conceptOf(c),
    inKind: !isMoney(c),
    amount: c.amount,
    txHash: c.txHash,
  }));
  const byConcept = Object.fromEntries(
    CONCEPTS.map((k) => {
      const rows = incomeRows.filter((r) => r.concept === k);
      return [k, { count: rows.length, total: sumBase(rows.map((r) => r.amount)).toString() }];
    }),
  ) as ReportData["income"]["byConcept"];
  const totalMoney = sumBase(incomeRows.filter((r) => !r.inKind).map((r) => r.amount));
  const totalInKind = sumBase(incomeRows.filter((r) => r.inKind).map((r) => r.amount));

  // Expenses.
  const periodPayments = allPayments
    .filter((p) => p.executedAt && p.executedAt >= start && p.executedAt < end)
    .sort((a, b) => a.executedAt!.getTime() - b.executedAt!.getTime() || Number(a.paymentId - b.paymentId));
  const invoiceRows = await db.select().from(invoices);
  const vendorRows = await db.select().from(vendors);
  const vendorByAddr = new Map(vendorRows.map((v) => [v.address.toLowerCase(), v]));
  const expenseRows: ExpenseRow[] = periodPayments.map((p) => {
    const inv =
      invoiceRows.find((i) => i.invoiceId && i.invoiceId.toLowerCase() === p.invoiceId.toLowerCase()) ??
      invoiceRows.find((i) => i.paymentId === p.paymentId);
    const vendor = vendorByAddr.get(p.vendor.toLowerCase());
    const line = lineById.get(p.lineId.toLowerCase());
    const extracted = (inv?.extracted ?? {}) as { concept?: unknown };
    const cuit = inv?.cuit ?? vendor?.cuit ?? null;
    return {
      paymentId: p.paymentId.toString(),
      date: p.executedAt!.toISOString(),
      vendor: vendor?.legalName ?? "Proveedor sin registrar",
      cuit: cuit === null ? null : formatCuit(cuit),
      comprobanteTipo: tipoLabel(inv?.tipo),
      comprobanteNumero: formatComprobante(inv?.ptoVta, inv?.nro),
      concept: typeof extracted.concept === "string" && extracted.concept ? extracted.concept : (line?.name ?? "Sin concepto"),
      lineSlug: line?.slug ?? "",
      lineName: line?.name ?? "Sin partida",
      amount: p.amount,
      rule: p.rule === "signers" ? "signers" : "auto",
      audit: auditOf(p.audit),
      overBudget: p.overBudget,
      budgetExpired: p.budgetExpired,
      invoiceUrl: inv?.fileUrl ?? null,
      txHash: p.executedTxHash,
    };
  });
  const totalExpenses = sumBase(expenseRows.map((e) => e.amount));

  // Per-line summary: allocated / spent come from the budget index (current state).
  const lineSummary = lines
    .map((l) => {
      const idx = indexById.get(l.lineId.toLowerCase());
      const allocated = BigInt(idx?.allocated ?? "0");
      const spent = BigInt(idx?.spent ?? "0");
      return {
        slug: l.slug,
        name: l.name,
        allocated: allocated.toString(),
        spent: spent.toString(),
        available: (allocated - spent).toString(),
        spentInPeriod: sumBase(expenseRows.filter((e) => e.lineSlug === l.slug).map((e) => e.amount)).toString(),
        over: spent > allocated,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  const budgetChanges = await executedChanges(db, { start, end });

  return {
    version: 1,
    period,
    periodLabel: periodLabel(period),
    header: {
      cooperadora: coop.name,
      school: coop.school,
      cuit: formatCuit(coop.cuit),
      ruce: coop.ruce,
      chainId: coop.chainId,
    },
    openingBalance: opening.toString(),
    closingBalance: (opening + totalMoney - totalExpenses).toString(),
    income: { rows: incomeRows, byConcept, totalMoney: totalMoney.toString(), totalInKind: totalInKind.toString() },
    expenses: { rows: expenseRows, total: totalExpenses.toString() },
    lines: lineSummary,
    budgetChanges,
    signatures: SIGNATURE_SLOTS,
  };
}


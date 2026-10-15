// Column definitions for the monthly report, in one place. They follow the draft in
// docs/investigacion-cooperadoras.md section 5 and are meant to be adjusted once the real
// CooperAr / Jujuy form is confirmed. The web view and the PDF both render from these.
import {
  explorerTxUrl, formatDate, formatPesos, shortHash,
} from "./format";
import type {
  BudgetChangeRow, ExpenseRow, IncomeConcept, IncomeRow, LineSummaryRow, ReportData,
} from "./types";

export interface Column<Row> {
  key: string;
  header: string;
  /** Relative width in the PDF table. */
  flex: number;
  align?: "left" | "right";
  value: (row: Row, report: ReportData) => string;
  /** Optional link wrapped around the cell text. */
  href?: (row: Row, report: ReportData) => string | null;
}

export const INCOME_CONCEPT_LABEL: Record<IncomeConcept, string> = {
  aportes_socios: "Member contributions",
  sin_identificar: "Unidentified contributions",
  especie: "In-kind contributions",
  trabajo: "Volunteer work",
};

export const RULE_LABEL = { auto: "Automatic (within the cap)", signers: "Signed" } as const;

export const AUDIT_LABEL = { cleared: "Revisado sin observaciones", flagged: "Observado" } as const;

export const incomeColumns: Column<IncomeRow>[] = [
  { key: "date", header: "Date", flex: 1.2, value: (r) => formatDate(r.date) },
  { key: "concept", header: "Concept", flex: 3, value: (r) => INCOME_CONCEPT_LABEL[r.concept] },
  {
    key: "reference", header: "Reference", flex: 2,
    value: (r) => (r.txHash ? shortHash(r.txHash) : "Manual entry"),
  },
  { key: "amount", header: "Amount", flex: 1.8, align: "right", value: (r) => formatPesos(r.amount) },
];

export const expenseColumns: Column<ExpenseRow>[] = [
  { key: "date", header: "Date", flex: 1.3, value: (r) => formatDate(r.date) },
  { key: "vendor", header: "Vendor", flex: 2.6, value: (r) => r.vendor },
  { key: "cuit", header: "Tax ID", flex: 2, value: (r) => r.cuit ?? "-" },
  {
    key: "comprobante", header: "Invoice", flex: 2.4,
    value: (r) => `${r.comprobanteTipo} ${r.comprobanteNumero}`,
    href: (r) => r.invoiceUrl,
  },
  { key: "concept", header: "Concept", flex: 2.2, value: (r) => r.concept },
  { key: "line", header: "Budget line", flex: 1.8, value: (r) => r.lineName },
  { key: "amount", header: "Amount", flex: 2, align: "right", value: (r) => formatPesos(r.amount) },
  {
    key: "rule", header: "Rule", flex: 1.8,
    value: (r) => {
      const flags = [r.overBudget ? "exceeded its line" : "", r.budgetExpired ? "expired budget" : ""].filter(Boolean);
      return [RULE_LABEL[r.rule], ...flags].join(" - ");
    },
  },
  {
    key: "audit", header: "Auditor", flex: 1.6,
    value: (r) => (r.audit ? AUDIT_LABEL[r.audit] : "-"),
  },
];

export const lineColumns: Column<LineSummaryRow>[] = [
  { key: "name", header: "Budget line", flex: 3, value: (r) => r.name },
  { key: "allocated", header: "Allocated", flex: 2, align: "right", value: (r) => formatPesos(r.allocated) },
  { key: "spent", header: "Spent", flex: 2, align: "right", value: (r) => formatPesos(r.spent) },
  { key: "available", header: "Available", flex: 2, align: "right", value: (r) => formatPesos(r.available) },
];

export const changeColumns: Column<BudgetChangeRow>[] = [
  { key: "date", header: "Date", flex: 1.3, value: (r) => formatDate(r.date) },
  { key: "description", header: "Change", flex: 4, value: (r) => r.description },
  { key: "reason", header: "Reason", flex: 3, value: (r) => r.reason ?? "-" },
  { key: "signers", header: "Signed by", flex: 2.4, value: (r) => (r.signers.length ? r.signers.join(", ") : "-") },
];

/** Link to the proof of a transaction, if the chain has an explorer. */
export function txUrl(report: ReportData, txHash: string | null): string | null {
  return explorerTxUrl(report.header.chainId, txHash);
}

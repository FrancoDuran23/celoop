// Shapes of the computed report (stored as JSON in `reports.data`) and of the panel.
// Amounts are wARS base units as decimal strings; dates are ISO strings.

export type IncomeConcept = "aportes_socios" | "sin_identificar" | "especie" | "trabajo";

export interface ReportHeader {
  cooperadora: string;
  school: string;
  cuit: string;
  ruce: string | null;
  chainId: number;
}

export interface IncomeRow {
  date: string;
  concept: IncomeConcept;
  /** especie and trabajo are valued by hand and do not move the cash balance. */
  inKind: boolean;
  amount: string;
  /** Transaction hash for on-chain money, null for manual entries. */
  txHash: string | null;
}

export interface ExpenseRow {
  paymentId: string;
  date: string;
  vendor: string;
  cuit: string | null;
  comprobanteTipo: string;
  comprobanteNumero: string;
  concept: string;
  lineSlug: string;
  lineName: string;
  amount: string;
  rule: "auto" | "signers";
  /** The auditor's verdict on chain; null = not audited. Missing in reports made before the auditor. */
  audit?: "cleared" | "flagged" | null;
  overBudget: boolean;
  budgetExpired: boolean;
  invoiceUrl: string | null;
  txHash: string | null;
}

export interface LineSummaryRow {
  slug: string;
  name: string;
  allocated: string;
  spent: string;
  available: string;
  /** Spent by payments executed during this period only. */
  spentInPeriod: string;
  over: boolean;
}

export interface BudgetChangeRow {
  date: string;
  kind: string;
  description: string;
  reason: string | null;
  /** Roles of the people who signed, never names. */
  signers: string[];
  txHash: string | null;
}

export interface SignatureSlot {
  role: string;
  label: string;
}

export interface ReportData {
  version: 1;
  period: string;
  periodLabel: string;
  header: ReportHeader;
  openingBalance: string;
  closingBalance: string;
  income: {
    rows: IncomeRow[];
    byConcept: Record<IncomeConcept, { count: number; total: string }>;
    /** Money in: moves the balance. */
    totalMoney: string;
    /** Especie and trabajo, informative. */
    totalInKind: string;
  };
  expenses: { rows: ExpenseRow[]; total: string };
  lines: LineSummaryRow[];
  budgetChanges: BudgetChangeRow[];
  signatures: SignatureSlot[];
}

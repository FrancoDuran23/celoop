// Data for the public panel at "/". Plain JSON (strings, no bigint) so it can cross the
// cache boundary. Contributions are only ever aggregated: no names, no per-person rows.
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import {
  approvals, budgetIndex, budgetLines, contributions, cooperadora, invoices, payments, reports,
} from "@/db/schema";
import { scopeId } from "@/lib/tenant";
import { executedChanges, loadLookups } from "./changes";
import { formatCuit, monthKey, sumBase } from "./format";
import type { BudgetChangeRow } from "./types";

export interface PanelLine {
  slug: string; name: string; allocated: string; spent: string; available: string;
  over: boolean; expired: boolean;
}
export interface PanelExpense {
  paymentId: string; date: string; vendor: string; cuit: string | null; lineName: string;
  amount: string; rule: "auto" | "signers"; approvals: number; signerCount: number;
  overBudget: boolean; budgetExpired: boolean; invoiceUrl: string | null; txHash: string | null;
  /** The auditor's verdict on chain; null = not audited (no auditor, or paid by signers first). */
  audit: "cleared" | "flagged" | null;
}
export interface PanelPending {
  paymentId: string; vendor: string; lineName: string; amount: string;
  approvals: number; missing: number; threshold: number;
  audit: "cleared" | "flagged" | null;
}
export interface PanelData {
  /** Which cooperative this is, so links to its reports and audits carry `?c=`. */
  cooperadoraId: number;
  header: { cooperadora: string; school: string; cuit: string; ruce: string | null; chainId: number };
  balance: string;
  balanceSource: "chain" | "db";
  expiredBudget: boolean;
  lines: PanelLine[];
  contributionsByMonth: Array<{ month: string; count: number; total: string }>;
  expenses: PanelExpense[];
  pending: PanelPending[];
  changes: BudgetChangeRow[];
  publishedReports: Array<{ period: string; publishedAt: string | null }>;
}

const auditOf = (a: string | null): "cleared" | "flagged" | null => (a === "cleared" || a === "flagged" ? a : null);

export interface PanelOptions {
  now?: Date;
  /** Live balance from the chain, in base units. Null or a failure falls back to the database. */
  liveBalance?: () => Promise<bigint | string | null>;
  /** Which cooperative's panel. The demo when unset. */
  cooperadoraId?: number;
}

export async function getPanelData(db: Db, opts: PanelOptions = {}): Promise<PanelData | null> {
  const now = opts.now ?? new Date();
  const id = scopeId(opts.cooperadoraId);
  const [coop] = await db.select().from(cooperadora).where(eq(cooperadora.id, id));
  if (!coop) return null;

  const l = await loadLookups(db, id);
  const lines = await db.select().from(budgetLines).where(eq(budgetLines.cooperadoraId, id));
  const index = await db.select().from(budgetIndex).where(eq(budgetIndex.cooperadoraId, id));
  const idx = new Map(index.map((i) => [i.lineId.toLowerCase(), i]));
  const nowSec = Math.floor(now.getTime() / 1000);

  const panelLines: PanelLine[] = lines
    .map((line) => {
      const i = idx.get(line.lineId.toLowerCase());
      const allocated = BigInt(i?.allocated ?? "0");
      const spent = BigInt(i?.spent ?? "0");
      return {
        slug: line.slug, name: line.name, allocated: allocated.toString(), spent: spent.toString(),
        available: (allocated - spent).toString(), over: spent > allocated,
        expired: i ? i.periodEnd < nowSec : false,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  const allContributions = await db.select().from(contributions).where(eq(contributions.cooperadoraId, id));
  const money = allContributions.filter((c) => c.kind === "dinero");
  const allPayments = await db.select().from(payments).where(eq(payments.cooperadoraId, id));
  const executed = allPayments.filter((p) => p.status === "executed");

  const dbBalance = sumBase(money.map((c) => c.amount)) - sumBase(executed.map((p) => p.amount));
  let balance = dbBalance;
  let balanceSource: PanelData["balanceSource"] = "db";
  if (opts.liveBalance) {
    try {
      const live = await opts.liveBalance();
      if (live !== null && live !== undefined) {
        balance = BigInt(live);
        balanceSource = "chain";
      }
    } catch {
      // keep the database balance
    }
  }

  const byMonth = new Map<string, { count: number; total: bigint }>();
  for (const c of money) {
    const k = monthKey(c.occurredAt);
    const cur = byMonth.get(k) ?? { count: 0, total: BigInt(0) };
    cur.count += 1;
    cur.total += BigInt(c.amount);
    byMonth.set(k, cur);
  }
  const contributionsByMonth = [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, v]) => ({ month, count: v.count, total: v.total.toString() }));

  const lineName = (id: string) => lines.find((x) => x.lineId.toLowerCase() === id.toLowerCase())?.name ?? "Sin partida";
  const invoiceRows = await db.select().from(invoices).where(eq(invoices.cooperadoraId, id));
  const vendorCuit = new Map<string, string | null>();
  const invFor = (p: (typeof allPayments)[number]) =>
    invoiceRows.find((i) => i.invoiceId && i.invoiceId.toLowerCase() === p.invoiceId.toLowerCase()) ??
    invoiceRows.find((i) => i.paymentId === p.paymentId);
  const vendorOf = (p: (typeof allPayments)[number]) => {
    const inv = invFor(p);
    vendorCuit.set(p.vendor, inv?.cuit ? formatCuit(inv.cuit) : null);
    return l.vendorName(p.vendor);
  };

  const expenses: PanelExpense[] = executed
    .sort((a, b) => (b.executedAt?.getTime() ?? 0) - (a.executedAt?.getTime() ?? 0) || Number(b.paymentId - a.paymentId))
    .map((p) => {
      const vendor = vendorOf(p);
      return {
        paymentId: p.paymentId.toString(),
        date: (p.executedAt ?? p.updatedAt).toISOString(),
        vendor, cuit: vendorCuit.get(p.vendor) ?? null,
        lineName: lineName(p.lineId), amount: p.amount,
        rule: p.rule === "signers" ? "signers" : "auto",
        approvals: p.approvals, signerCount: l.signerCount,
        overBudget: p.overBudget, budgetExpired: p.budgetExpired,
        invoiceUrl: invFor(p)?.fileUrl ?? null, txHash: p.executedTxHash,
        audit: auditOf(p.audit),
      };
    });

  const pending: PanelPending[] = [];
  for (const p of allPayments.filter((x) => x.status === "pending")) {
    const signed = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.cooperadoraId, id), eq(approvals.targetId, p.paymentId)));
    const count = Math.max(p.approvals, signed.filter((a) => a.target === "payment").length);
    pending.push({
      paymentId: p.paymentId.toString(), vendor: vendorOf(p), lineName: lineName(p.lineId),
      amount: p.amount, approvals: count, missing: Math.max(l.threshold - count, 0), threshold: l.threshold,
      audit: auditOf(p.audit),
    });
  }

  const changes = (await executedChanges(db, undefined, id)).reverse();
  const published = await db
    .select()
    .from(reports)
    .where(and(eq(reports.cooperadoraId, id), eq(reports.status, "publicada")))
    .orderBy(desc(reports.period));

  return {
    cooperadoraId: id,
    header: { cooperadora: coop.name, school: coop.school, cuit: formatCuit(coop.cuit), ruce: coop.ruce, chainId: coop.chainId },
    balance: balance.toString(), balanceSource,
    expiredBudget: panelLines.some((x) => x.expired),
    lines: panelLines, contributionsByMonth, expenses, pending, changes,
    publishedReports: published.map((r) => ({ period: r.period, publishedAt: r.publishedAt?.toISOString() ?? null })),
  };
}

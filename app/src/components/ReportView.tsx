import type { ReactNode } from "react";
import {
  changeColumns, expenseColumns, incomeColumns, INCOME_CONCEPT_LABEL, lineColumns, txUrl, type Column,
} from "@/lib/report/columns";
import type { IncomeConcept, ReportData } from "@/lib/report/types";
import { Banner } from "./Banner";
import { Card } from "./Card";
import { Money } from "./Money";

function DataTable<Row>({ columns, rows, report, caption }: { columns: Column<Row>[]; rows: Row[]; report: ReportData; caption: string }) {
  if (rows.length === 0) return <p className="text-muted">No movements this month.</p>;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-[3px] border-ink">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-2 py-2 font-extrabold ${c.align === "right" ? "text-right" : ""}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b-2 border-line align-top">
              {columns.map((c) => {
                const href = c.href?.(r, report);
                const text: ReactNode = href ? <a href={href} target="_blank" rel="noopener noreferrer">{c.value(r, report)}</a> : c.value(r, report);
                return <td key={c.key} className={`px-2 py-2 ${c.align === "right" ? "num text-right whitespace-nowrap" : ""}`}>{text}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Line({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b-2 border-line py-2 ${strong ? "font-extrabold" : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The monthly report on the web, from the stored ReportData. */
export function ReportView({ report, status, pdfHref }: { report: ReportData; status: string; pdfHref?: string }) {
  const h = report.header;
  const concepts = Object.keys(INCOME_CONCEPT_LABEL) as IncomeConcept[];
  const expenseLinks = report.expenses.rows.filter((e) => e.txHash && txUrl(report, e.txHash));
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6">
      <section className="overflow-hidden rounded-2xl border-[3px] border-ink bg-surface shadow-hard">
        <div className="minga-band border-b-[3px] border-ink px-4 py-3 text-sm font-extrabold uppercase tracking-wide text-white sm:px-5">
          Monthly statement of accounts
        </div>
        <div className="p-4 sm:p-5">
          <h1 className="text-3xl font-black leading-tight tracking-tight">{report.periodLabel}</h1>
          <dl className="mt-3 grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-2 sm:gap-x-6">
            <div><dt className="inline text-muted">Co-op: </dt><dd className="inline font-semibold">{h.cooperadora}</dd></div>
            <div><dt className="inline text-muted">School: </dt><dd className="inline font-semibold">{h.school}</dd></div>
            <div><dt className="inline text-muted">Tax ID (CUIT): </dt><dd className="num inline font-semibold">{h.cuit}</dd></div>
            <div><dt className="inline text-muted">Registry no. (RUCE): </dt><dd className="num inline font-semibold">{h.ruce ?? "-"}</dd></div>
          </dl>
          {status !== "publicada" ? (
            <div className="mt-3">
              <Banner tone="warn">
                {status === "borrador" ? "Draft for review. Not public yet." : "Reviewed. Waiting to be published."}
              </Banner>
            </div>
          ) : null}
          {pdfHref ? <p className="mt-3"><a href={pdfHref} className="font-bold">Download PDF</a></p> : null}
        </div>
      </section>

      <Card title="Balances" hue="yellow">
        <dl>
          <Line label="Opening balance"><Money value={report.openingBalance} /></Line>
          <Line label="Cash income"><Money value={report.income.totalMoney} /></Line>
          <Line label="Payments"><Money value={report.expenses.total} /></Line>
          <Line label="Closing balance" strong><Money value={report.closingBalance} /></Line>
        </dl>
      </Card>

      <Card title="Income" description="No names are shown. In-kind and volunteer-work contributions are valued by hand and do not add to the cash balance." hue="blue">
        <dl className="mb-4">
          {concepts.map((k) => (
            <Line key={k} label={`${INCOME_CONCEPT_LABEL[k]} (${report.income.byConcept[k].count})`}>
              <Money value={report.income.byConcept[k].total} />
            </Line>
          ))}
        </dl>
        <DataTable columns={incomeColumns} rows={report.income.rows} report={report} caption="Income detail" />
      </Card>

      <Card title="Payments" description="Every payment has its invoice and its proof on the public ledger." hue="red">
        <DataTable columns={expenseColumns} rows={report.expenses.rows} report={report} caption="Payment detail" />
        {expenseLinks.length > 0 ? (
          <p className="mt-3 text-sm">
            Proofs of payment:{" "}
            {expenseLinks.map((e, i) => (
              <span key={e.paymentId}>
                {i > 0 ? ", " : ""}
                <a href={txUrl(report, e.txHash)!} target="_blank" rel="noopener noreferrer">payment {e.paymentId}</a>
              </span>
            ))}
          </p>
        ) : null}
        <p className="mt-3 text-right font-extrabold">Total payments: <Money value={report.expenses.total} /></p>
      </Card>

      <Card title="Summary by budget line" hue="blue">
        <DataTable columns={lineColumns} rows={report.lines} report={report} caption="Summary by budget line" />
      </Card>

      <Card title="Budget and rule changes" hue="yellow">
        <DataTable columns={changeColumns} rows={report.budgetChanges} report={report} caption="Budget changes" />
      </Card>

      <Card title="Signatures" hue="red">
        <div className="grid grid-cols-1 gap-8 pt-8 sm:grid-cols-3">
          {report.signatures.map((s) => (
            <p key={s.role} className="border-t-[3px] border-ink pt-1 text-center text-sm font-semibold">{s.label}</p>
          ))}
        </div>
      </Card>
    </main>
  );
}

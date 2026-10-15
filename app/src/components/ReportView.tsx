import type { ReactNode } from "react";
import {
  changeColumns, expenseColumns, incomeColumns, INCOME_CONCEPT_LABEL, lineColumns, txUrl, type Column,
} from "@/lib/report/columns";
import type { IncomeConcept, ReportData } from "@/lib/report/types";
import { Card } from "./Card";
import { Money } from "./Money";

function DataTable<Row>({ columns, rows, report, caption }: { columns: Column<Row>[]; rows: Row[]; report: ReportData; caption: string }) {
  if (rows.length === 0) return <p className="text-muted">Sin movimientos en el mes.</p>;
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-[640px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-foreground">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-2 py-2 font-semibold ${c.align === "right" ? "text-right" : ""}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top">
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
    <div className={`flex items-baseline justify-between gap-3 border-b border-line py-2 ${strong ? "font-bold" : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The rendición on the web, from the stored ReportData. */
export function ReportView({ report, status, pdfHref }: { report: ReportData; status: string; pdfHref?: string }) {
  const h = report.header;
  const concepts = Object.keys(INCOME_CONCEPT_LABEL) as IncomeConcept[];
  const expenseLinks = report.expenses.rows.filter((e) => e.txHash && txUrl(report, e.txHash));
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
      <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <p className="text-sm font-medium uppercase tracking-wide text-muted">Rendición mensual de cuentas</p>
        <h1 className="mt-1 text-2xl font-bold leading-tight">{report.periodLabel}</h1>
        <dl className="mt-3 grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-2 sm:gap-x-6">
          <div><dt className="inline text-muted">Cooperadora: </dt><dd className="inline">{h.cooperadora}</dd></div>
          <div><dt className="inline text-muted">Escuela: </dt><dd className="inline">{h.school}</dd></div>
          <div><dt className="inline text-muted">CUIT: </dt><dd className="num inline">{h.cuit}</dd></div>
          <div><dt className="inline text-muted">N° RUCE: </dt><dd className="num inline">{h.ruce ?? "-"}</dd></div>
        </dl>
        {status !== "publicada" ? (
          <p className="mt-3 rounded border border-warn bg-warn-soft px-3 py-2 text-sm font-medium text-warn">
            {status === "borrador" ? "Borrador para revisar. Todavía no es público." : "Revisada. Falta publicarla."}
          </p>
        ) : null}
        {pdfHref ? <p className="mt-3"><a href={pdfHref} className="font-medium">Descargar PDF</a></p> : null}
      </section>

      <Card title="Saldos">
        <dl>
          <Line label="Saldo inicial"><Money value={report.openingBalance} /></Line>
          <Line label="Ingresos en dinero"><Money value={report.income.totalMoney} /></Line>
          <Line label="Egresos"><Money value={report.expenses.total} /></Line>
          <Line label="Saldo final" strong><Money value={report.closingBalance} /></Line>
        </dl>
      </Card>

      <Card title="Ingresos" description="No se muestran nombres. Lo aportado en especie y en trabajo se valoriza a mano y no suma al saldo en dinero.">
        <dl className="mb-4">
          {concepts.map((k) => (
            <Line key={k} label={`${INCOME_CONCEPT_LABEL[k]} (${report.income.byConcept[k].count})`}>
              <Money value={report.income.byConcept[k].total} />
            </Line>
          ))}
        </dl>
        <DataTable columns={incomeColumns} rows={report.income.rows} report={report} caption="Detalle de ingresos" />
      </Card>

      <Card title="Egresos" description="Cada pago tiene su factura y su comprobante en el registro público.">
        <DataTable columns={expenseColumns} rows={report.expenses.rows} report={report} caption="Detalle de egresos" />
        {expenseLinks.length > 0 ? (
          <p className="mt-3 text-sm">
            Comprobantes de pago:{" "}
            {expenseLinks.map((e, i) => (
              <span key={e.paymentId}>
                {i > 0 ? ", " : ""}
                <a href={txUrl(report, e.txHash)!} target="_blank" rel="noopener noreferrer">pago {e.paymentId}</a>
              </span>
            ))}
          </p>
        ) : null}
        <p className="mt-3 text-right font-bold">Total de egresos: <Money value={report.expenses.total} /></p>
      </Card>

      <Card title="Resumen por partida">
        <DataTable columns={lineColumns} rows={report.lines} report={report} caption="Resumen por partida" />
      </Card>

      <Card title="Cambios de presupuesto y configuración">
        <DataTable columns={changeColumns} rows={report.budgetChanges} report={report} caption="Cambios de presupuesto" />
      </Card>

      <Card title="Firmas">
        <div className="grid grid-cols-1 gap-8 pt-8 sm:grid-cols-3">
          {report.signatures.map((s) => (
            <p key={s.role} className="border-t border-foreground pt-1 text-center text-sm">{s.label}</p>
          ))}
        </div>
      </Card>
    </main>
  );
}

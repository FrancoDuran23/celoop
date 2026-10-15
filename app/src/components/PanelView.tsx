import Link from "next/link";
import { formatDate, MONTHS_ES, periodLabel } from "@/lib/report/format";
import type { PanelData } from "@/lib/report/panel";
import { Banner, Tag } from "./Banner";
import { Card } from "./Card";
import { Money } from "./Money";
import { ProgressBar } from "./ProgressBar";
import { TxLink } from "./TxLink";

function monthName(key: string) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_ES[m - 1][0].toUpperCase()}${MONTHS_ES[m - 1].slice(1)} ${y}`;
}

/** The public transparency panel. Pure view over PanelData. */
export function PanelView({ data }: { data: PanelData | null }) {
  if (!data) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10">
        <Card title="Todavía no hay datos">
          <p>La cooperadora todavía no cargó su información. Volvé a probar en un rato.</p>
        </Card>
      </main>
    );
  }
  const { header } = data;
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-6">
      <section aria-labelledby="titulo" className="rounded-lg border border-line bg-surface p-4 sm:p-5">
        <h1 id="titulo" className="text-2xl font-bold leading-tight">{header.cooperadora}</h1>
        <p className="mt-1 text-muted">{header.school}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">CUIT</dt>
          <dd className="num">{header.cuit}</dd>
          <dt className="text-muted">N° RUCE</dt>
          <dd className="num">{header.ruce ?? "-"}</dd>
        </dl>
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm text-muted">Saldo actual de la cooperadora</p>
          <p className="text-3xl font-bold"><Money value={data.balance} /></p>
          <p className="text-xs text-muted">
            {data.balanceSource === "chain" ? "Leído en este momento del registro público." : "Calculado con los movimientos registrados."}
          </p>
        </div>
      </section>

      {data.expiredBudget ? (
        <Banner tone="warn">Presupuesto 2026 vencido, en uso hasta la próxima asamblea.</Banner>
      ) : null}

      <Card title="Partidas del presupuesto" description="Cuánto se asignó, cuánto se gastó y cuánto queda en cada partida.">
        {data.lines.length === 0 ? (
          <p className="text-muted">Todavía no hay partidas cargadas.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {data.lines.map((l) => (
              <li key={l.slug}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">{l.name}</span>
                  {l.over ? <Tag tone="danger">Se pasó de la partida</Tag> : null}
                </div>
                <div className="my-1.5"><ProgressBar spent={l.spent} allocated={l.allocated} label={l.name} /></div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-muted">Asignado</dt><dd><Money value={l.allocated} /></dd></div>
                  <div><dt className="text-muted">Gastado</dt><dd><Money value={l.spent} /></dd></div>
                  <div><dt className="text-muted">Disponible</dt><dd><Money value={l.available} negative={l.over} className={l.over ? "font-semibold" : ""} /></dd></div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Aportes por mes" description="Solo cantidades y totales. No se muestran nombres.">
        {data.contributionsByMonth.length === 0 ? (
          <p className="text-muted">Todavía no hay aportes registrados.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr><th className="py-1 font-medium">Mes</th><th className="py-1 text-right font-medium">Aportes</th><th className="py-1 text-right font-medium">Total</th></tr>
            </thead>
            <tbody>
              {data.contributionsByMonth.map((m) => (
                <tr key={m.month} className="border-t border-line">
                  <td className="py-2">{monthName(m.month)}</td>
                  <td className="num py-2 text-right">{m.count}</td>
                  <td className="py-2 text-right"><Money value={m.total} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Egresos" description="Del más reciente al más viejo. Cada pago tiene su factura y su comprobante en el registro público.">
        {data.expenses.length === 0 ? (
          <p className="text-muted">Todavía no hay pagos realizados.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.expenses.map((e) => (
              <li key={e.paymentId} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{e.vendor}</span>
                  <Money value={e.amount} className="font-semibold" />
                </div>
                <p className="text-sm text-muted">
                  {formatDate(e.date)} · {e.lineName}{e.cuit ? ` · CUIT ${e.cuit}` : ""}
                </p>
                <p className="mt-1 text-sm">
                  {e.rule === "auto" ? "Automático (dentro del tope)" : `Con firmas (${e.approvals} de ${e.signerCount})`}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {e.audit === "cleared" ? <Tag tone="ok">Revisado por el auditor</Tag> : null}
                  {e.audit === "flagged" ? <Tag tone="warn">Observado por el auditor</Tag> : null}
                  {e.overBudget ? <Tag tone="danger">Excedió la partida</Tag> : null}
                  {e.budgetExpired ? <Tag tone="warn">Presupuesto vencido</Tag> : null}
                  {e.invoiceUrl ? (
                    <a href={e.invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-sm">Ver factura</a>
                  ) : null}
                  {e.audit ? <a href={`/auditoria/${e.paymentId}`} className="text-sm">Informe del auditor</a> : null}
                  <TxLink txHash={e.txHash} chainId={header.chainId} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Pagos esperando firmas">
        {data.pending.length === 0 ? (
          <p className="text-muted">No hay pagos esperando firmas.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.pending.map((p) => (
              <li key={p.paymentId} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{p.vendor}</span>
                  <Money value={p.amount} className="font-semibold" />
                </div>
                <p className="text-sm text-muted">{p.lineName}</p>
                <p className="text-sm">
                  Tiene {p.approvals} {p.approvals === 1 ? "firma" : "firmas"}
                  {p.missing > 0 ? `, faltan ${p.missing}.` : ", ya alcanza el mínimo."}
                </p>
                {p.audit ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                    {p.audit === "flagged" ? <Tag tone="warn">Observado por el auditor</Tag> : <Tag tone="ok">Revisado por el auditor</Tag>}
                    <a href={`/auditoria/${p.paymentId}`} className="text-sm">Informe del auditor</a>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Cambios de presupuesto y configuración">
        {data.changes.length === 0 ? (
          <p className="text-muted">No hubo cambios.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.changes.map((c, i) => (
              <li key={`${c.txHash ?? "c"}-${i}`} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm text-muted">{formatDate(c.date)}</p>
                <p>{c.description}</p>
                {c.reason ? <p className="text-sm">Motivo: {c.reason}</p> : null}
                <p className="text-sm text-muted">Firmaron: {c.signers.length ? c.signers.join(", ") : "sin datos"}</p>
                <TxLink txHash={c.txHash} chainId={header.chainId} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Rendiciones publicadas">
        {data.publishedReports.length === 0 ? (
          <p className="text-muted">Todavía no se publicó ninguna rendición.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.publishedReports.map((r) => (
              <li key={r.period} className="flex flex-wrap gap-x-4">
                <Link href={`/rendicion/${r.period}`} className="font-medium">
                  Rendición de {periodLabel(r.period)}
                </Link>
                <a href={`/rendicion/${r.period}/pdf`} className="text-sm">Descargar PDF</a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

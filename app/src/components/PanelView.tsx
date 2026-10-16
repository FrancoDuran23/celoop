import Link from "next/link";
import { formatDate, MONTHS_EN, periodLabel } from "@/lib/report/format";
import type { PanelData } from "@/lib/report/panel";
import { APP_NAME } from "@/lib/brand";
import { coopQuery } from "@/lib/coop-query";
import { Banner, Tag } from "./Banner";
import { Robot, Sparks } from "./Brand";
import { Card } from "./Card";
import { Money } from "./Money";
import { ProgressBar } from "./ProgressBar";
import { TxLink } from "./TxLink";

function monthName(key: string) {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_EN[m - 1]} ${y}`;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-3 text-muted">
      <Robot size={36} hue="yellow" />
      <span>{children}</span>
    </p>
  );
}

/** The public transparency panel. Pure view over PanelData. */
export function PanelView({ data }: { data: PanelData | null }) {
  if (!data) {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-10">
        <Card title="Nothing here yet" hue="yellow">
          <Empty>This co-op has not loaded its information yet. Come back in a bit.</Empty>
        </Card>
      </main>
    );
  }
  const { header } = data;
  const q = coopQuery(data.cooperadoraId);
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6">
      <section aria-labelledby="title" className="overflow-hidden rounded-2xl border-[3px] border-ink bg-surface shadow-hard">
        <div className="minga-band flex items-center justify-between gap-4 border-b-[3px] border-ink px-4 py-3 text-white sm:px-5">
          <p className="text-sm font-extrabold uppercase tracking-wide">Public ledger · live</p>
          <Sparks className="hidden sm:block" />
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:p-5">
          <div>
            <h1 id="title" className="text-3xl font-black leading-tight tracking-tight text-balance">{header.cooperadora}</h1>
            <p className="mt-1 text-lg font-semibold text-muted">{header.school}</p>
            <dl className="mt-3 grid max-w-sm grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Tax ID (CUIT)</dt>
              <dd className="num font-semibold">{header.cuit}</dd>
              <dt className="text-muted">Registry no. (RUCE)</dt>
              <dd className="num font-semibold">{header.ruce ?? "-"}</dd>
            </dl>
          </div>
          <div className="rounded-2xl border-[3px] border-ink bg-yellow px-4 py-3 shadow-hard-sm sm:min-w-64">
            <p className="text-sm font-bold">Current balance</p>
            <p className="text-3xl font-black leading-tight"><Money value={data.balance} /></p>
            <p className="mt-1 text-xs font-semibold text-yellow-ink">
              {data.balanceSource === "chain" ? "Read from the ledger just now." : "Computed from recorded movements."}
            </p>
          </div>
        </div>
      </section>

      {data.expiredBudget ? (
        <Banner tone="warn">The 2026 budget has expired and stays in use until the next assembly votes a new one.</Banner>
      ) : null}

      <Card title="Budget lines" description="How much was allocated, spent and what is left in each line." hue="blue">
        {data.lines.length === 0 ? (
          <Empty>No budget lines loaded yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-4">
            {data.lines.map((l) => (
              <li key={l.slug}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-bold">{l.name}</span>
                  {l.over ? <Tag tone="danger">Over budget</Tag> : null}
                </div>
                <div className="my-1.5"><ProgressBar spent={l.spent} allocated={l.allocated} label={l.name} /></div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-muted">Allocated</dt><dd className="font-semibold"><Money value={l.allocated} /></dd></div>
                  <div><dt className="text-muted">Spent</dt><dd className="font-semibold"><Money value={l.spent} /></dd></div>
                  <div><dt className="text-muted">Available</dt><dd className="font-semibold"><Money value={l.available} negative={l.over} /></dd></div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Contributions by month" description="Counts and totals only. No names, ever." hue="yellow">
        {data.contributionsByMonth.length === 0 ? (
          <Empty>No contributions recorded yet.</Empty>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-muted">
              <tr><th className="py-1 font-bold">Month</th><th className="py-1 text-right font-bold">Contributions</th><th className="py-1 text-right font-bold">Total</th></tr>
            </thead>
            <tbody>
              {data.contributionsByMonth.map((m) => (
                <tr key={m.month} className="border-t-2 border-line">
                  <td className="py-2 font-semibold">{monthName(m.month)}</td>
                  <td className="num py-2 text-right">{m.count}</td>
                  <td className="py-2 text-right font-semibold"><Money value={m.total} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Payments" description="Newest first. Every payment has its invoice and its proof on the public ledger." hue="red">
        {data.expenses.length === 0 ? (
          <Empty>No payments made yet.</Empty>
        ) : (
          <ul className="divide-y-2 divide-line">
            {data.expenses.map((e) => (
              <li key={e.paymentId} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-bold">{e.vendor}</span>
                  <Money value={e.amount} className="font-extrabold" />
                </div>
                <p className="text-sm text-muted">
                  {formatDate(e.date)} · {e.lineName}{e.cuit ? ` · CUIT ${e.cuit}` : ""}
                </p>
                <p className="mt-1 text-sm">
                  {e.rule === "auto" ? "Automatic (within the cap)" : `Signed (${e.approvals} of ${e.signerCount})`}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {e.audit === "cleared" ? <Tag tone="ok">Reviewed by the auditor</Tag> : null}
                  {e.audit === "flagged" ? <Tag tone="warn">Flagged by the auditor</Tag> : null}
                  {e.overBudget ? <Tag tone="danger">Exceeded its line</Tag> : null}
                  {e.budgetExpired ? <Tag tone="warn">Expired budget</Tag> : null}
                  {e.invoiceUrl ? (
                    <a href={e.invoiceUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold">View invoice</a>
                  ) : null}
                  {e.audit ? <a href={`/auditoria/${e.paymentId}${q}`} className="text-sm font-semibold">Auditor’s report</a> : null}
                  <TxLink txHash={e.txHash} chainId={header.chainId} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Waiting for signatures" hue="blue">
        {data.pending.length === 0 ? (
          <Empty>No payments waiting for signatures.</Empty>
        ) : (
          <ul className="divide-y-2 divide-line">
            {data.pending.map((p) => (
              <li key={p.paymentId} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-bold">{p.vendor}</span>
                  <Money value={p.amount} className="font-extrabold" />
                </div>
                <p className="text-sm text-muted">{p.lineName}</p>
                <p className="text-sm">
                  Has {p.approvals} {p.approvals === 1 ? "signature" : "signatures"}
                  {p.missing > 0 ? `, ${p.missing} more needed.` : ", enough to go ahead."}
                </p>
                {p.audit ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                    {p.audit === "flagged" ? <Tag tone="warn">Flagged by the auditor</Tag> : <Tag tone="ok">Reviewed by the auditor</Tag>}
                    <a href={`/auditoria/${p.paymentId}${q}`} className="text-sm font-semibold">Auditor’s report</a>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Budget and rule changes" hue="yellow">
        {data.changes.length === 0 ? (
          <Empty>No changes so far.</Empty>
        ) : (
          <ul className="divide-y-2 divide-line">
            {data.changes.map((c, i) => (
              <li key={`${c.txHash ?? "c"}-${i}`} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm text-muted">{formatDate(c.date)}</p>
                <p className="font-semibold">{c.description}</p>
                {c.reason ? <p className="text-sm">Reason: {c.reason}</p> : null}
                <p className="text-sm text-muted">Signed by: {c.signers.length ? c.signers.join(", ") : "no data"}</p>
                <TxLink txHash={c.txHash} chainId={header.chainId} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Published monthly reports" hue="red">
        {data.publishedReports.length === 0 ? (
          <Empty>No monthly report has been published yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.publishedReports.map((r) => (
              <li key={r.period} className="flex flex-wrap gap-x-4">
                <Link href={`/rendicion/${r.period}${q}`} className="font-bold">
                  Report for {periodLabel(r.period)}
                </Link>
                <a href={`/rendicion/${r.period}/pdf${q}`} className="text-sm font-semibold">Download PDF</a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-center text-sm text-muted">
        New here? <Link href="/#how">Read how {APP_NAME} works</Link>.
      </p>
    </main>
  );
}

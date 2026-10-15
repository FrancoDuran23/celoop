"use client";
// "Every peso, in the open": the public ledger, live. Movements land by themselves (contributions in,
// bills paid, one big repair with signatures) and the totals, the bar and the line detail follow.
// The bar is everything collected this year, split by budget line, with what is left as the hatched end.
import Link from "next/link";
import { useEffect, useState } from "react";
import { pesos, THRESHOLD } from "./demo-model";
import { lineBudget, ledgerAt, LIVE, type LiveEvent, type Payment, type SegmentId } from "./transparency-data";
import { useAutoplay } from "./use-autoplay";

const HATCH = "repeating-linear-gradient(45deg, var(--line) 0 2px, transparent 2px 7px)";
const STEP_MS = 2600;
const HOLD_MS = 5000;
/** The day starts with this many movements already on the ledger, so the feed is never empty. */
const FIRST = 2;

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border-2 border-line bg-paper px-3 py-2">
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted">{label}</p>
      <p key={value} className="demo-flash text-xl font-black tracking-tight sm:text-2xl">{value}</p>
      <p className="text-[11px] leading-snug text-muted">{note}</p>
    </div>
  );
}

function RuleBadge({ rule }: { rule: Payment["rule"] }) {
  return rule === "auto" ? (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border-2 border-ink bg-blue-soft px-1.5 py-0.5 text-[10px] font-black uppercase">
      <span aria-hidden="true">✓</span> Automatic
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border-2 border-ink bg-yellow px-1.5 py-0.5 text-[10px] font-black uppercase">
      <span aria-hidden="true">✍</span> {THRESHOLD} signatures
    </span>
  );
}

function FeedItem({ e, fresh }: { e: LiveEvent; fresh: boolean }) {
  const isIn = e.kind === "in";
  return (
    <li className={`demo-in flex items-center gap-2 rounded-lg border-2 px-2 py-1.5 text-xs ${fresh ? "demo-flash border-ink" : "border-line"}`}>
      <span
        aria-label={isIn ? "Money in" : "Money out"}
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-md border-2 border-ink text-xs font-black ${isIn ? "bg-blue text-white" : e.payment.rule === "signed" ? "bg-yellow" : "bg-blue-soft"}`}
      >
        {isIn ? "+" : e.payment.rule === "signed" ? "✍" : "✓"}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate font-bold">{isIn ? e.text : e.payment.vendor}</span>
        <span className="block truncate text-[11px] text-muted">{isIn ? "No name on the public ledger" : `${e.payment.invoice} · ${e.payment.rule === "auto" ? "automatic" : `${THRESHOLD} signatures`}`}</span>
      </span>
      <span className="num shrink-0 font-black">
        {isIn ? "+" : "−"}
        {pesos(isIn ? e.amount : e.payment.amount)}
      </span>
    </li>
  );
}

export function Spending() {
  const { ref, playing, frozen, running, toggle } = useAutoplay<HTMLDivElement>();
  const [tickState, setTick] = useState(FIRST);
  const tick = frozen ? LIVE.length : tickState;
  const view = ledgerAt(tick);
  const [selected, setSelected] = useState<SegmentId>("mantenimiento");
  const [hover, setHover] = useState<SegmentId | null>(null);

  // A new movement every few seconds; after the last one, hold, then start the day again.
  useEffect(() => {
    if (!running) return;
    const done = tickState >= LIVE.length;
    const timer = setTimeout(() => setTick(done ? FIRST : tickState + 1), done ? HOLD_MS : STEP_MS);
    return () => clearTimeout(timer);
  }, [running, tickState]);

  const { segments, totals, payments, feed } = view;
  const pct = (n: number) => (n / totals.collected) * 100;
  const seg = segments.find((s) => s.id === selected)!;
  const tip = hover ? segments.find((s) => s.id === hover)! : null;
  const offsets = segments.reduce<number[]>((acc, s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + pct(segments[i - 1].amount)], []);
  const rows = seg.lines.flatMap((id) => payments[id]);
  const budget = lineBudget(seg.lines);
  const spentNow = rows.reduce((s, p) => s + p.amount, 0);
  const over = seg.id !== "left" && spentNow > budget.allocated;

  return (
    <div ref={ref}>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
        <Stat label="Collected" value={pesos(totals.collected)} note={`${totals.contributions} contributions, no names`} />
        <Stat label="Spent" value={pesos(totals.spent)} note={`${totals.payments} payments, all public`} />
        <Stat label="In the account" value={pesos(totals.balance)} note="readable on chain, live" />
        <Stat label="With invoice" value={`${totals.payments} of ${totals.payments}`} note={`${totals.signed} needed ${THRESHOLD} signatures`} />
      </div>

      <p className="mt-4 text-sm font-extrabold">Where the money collected this year went</p>
      <div className="relative mt-2">
        {tip ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border-2 border-ink bg-surface px-2.5 py-1.5 text-xs shadow-hard-xs"
            style={{ left: `clamp(70px, ${offsets[segments.indexOf(tip)] + pct(tip.amount) / 2}%, calc(100% - 70px))` }}
          >
            <span className="font-black">{pesos(tip.amount)}</span> <span className="text-muted">· {Math.round(pct(tip.amount))}% · {tip.name}</span>
          </div>
        ) : null}
        <div className="flex h-12 gap-[2px] overflow-hidden rounded-xl border-[3px] border-ink bg-surface sm:h-14" role="group" aria-label="Money collected this year, split by where it went">
          {segments.map((s) => {
            const w = pct(s.amount);
            const on = s.id === selected;
            return (
              <button
                key={s.id}
                aria-pressed={on}
                aria-label={`${s.name}: ${pesos(s.amount)}, ${Math.round(w)}% of what was collected`}
                onClick={() => setSelected(s.id)}
                onPointerEnter={() => setHover(s.id)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(s.id)}
                onBlur={() => setHover(null)}
                className={`relative flex h-full min-w-0 items-center justify-center px-1 transition-[width,opacity] duration-700 ease-out focus-visible:z-10 ${on ? "opacity-100" : "opacity-70 hover:opacity-90"}`}
                style={{ width: `${w}%`, background: s.id === "left" ? HATCH : s.color }}
              >
                {w > 11 ? <span className={`truncate text-[11px] font-black sm:text-xs ${s.ink === "white" ? "text-white" : "text-ink"}`}>{Math.round(w)}%</span> : null}
                {on ? <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1.5 bg-ink" /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Legend">
        {segments.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => setSelected(s.id)}
              aria-pressed={s.id === selected}
              className={`flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-xs font-bold ${s.id === selected ? "border-ink bg-surface shadow-hard-xs" : "border-line bg-paper hover:border-ink"}`}
            >
              <span aria-hidden="true" className="h-3 w-3 rounded-[3px] border border-ink/40" style={{ background: s.id === "left" ? HATCH : s.color }} />
              {s.name}
              <span className="num font-normal text-muted">{pesos(s.amount)}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Live feed first on phones: it's the moving part. */}
        <div className="rounded-2xl border-[3px] border-ink bg-surface p-3 lg:order-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-blue-ink">
              <span className={`h-2 w-2 rounded-full bg-red ${running ? "demo-live" : ""}`} aria-hidden="true" /> Landing on the ledger now
            </p>
            <button onClick={toggle} aria-pressed={!playing} className="press shrink-0 rounded-lg border-2 border-ink bg-surface px-2 py-0.5 text-[11px] font-extrabold">
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
          </div>
          {feed.length === 0 ? (
            <p className="py-3 text-xs text-muted">Watching for the next movement…</p>
          ) : (
            <ul className="flex flex-col gap-1.5 [&>li:nth-child(n+4)]:hidden lg:[&>li:nth-child(n+4)]:flex lg:[&>li:nth-child(n+6)]:hidden" aria-live="off">
              {feed.map((e, i) => (
                <FeedItem key={LIVE.indexOf(e)} e={e} fresh={i === 0} />
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border-[3px] border-ink bg-paper p-3 sm:p-4 lg:order-1">
          {seg.id === "left" ? (
            <div>
              <p className="text-base font-black">{pesos(seg.amount)} still in the co-op&rsquo;s account</p>
              <p className="mt-1 text-sm text-muted">
                It sits in a contract, not in anyone&rsquo;s bank account. Anyone can read the balance on chain, at any time, and it can only
                leave through the contract&rsquo;s rules.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="flex items-center gap-2 text-base font-black">
                  {seg.name}
                  {over ? <span className="rounded border-2 border-ink bg-red px-1 text-[10px] font-black uppercase text-white">! Over its line</span> : null}
                </p>
                <p className="num text-xs text-muted">
                  {pesos(spentNow)} spent of {pesos(budget.allocated)} voted by the assembly
                </p>
              </div>
              {rows.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No payments yet.</p>
              ) : (
                <table className="mt-2 w-full border-collapse text-left text-sm">
                  <caption className="sr-only">Payments from {seg.name}</caption>
                  <thead className="hidden text-[11px] uppercase tracking-wide text-muted sm:table-header-group">
                    <tr>
                      <th scope="col" className="py-1 pr-2 font-extrabold">Date</th>
                      <th scope="col" className="py-1 pr-2 font-extrabold">Paid to, for</th>
                      <th scope="col" className="py-1 pr-2 font-extrabold">How</th>
                      <th scope="col" className="py-1 text-right font-extrabold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 4).map((p) => (
                      <tr key={p.invoice} className={`grid grid-cols-[auto_1fr_auto] gap-x-2 border-t-2 border-line py-2 sm:table-row sm:py-0 ${p.date === "Today" ? "demo-flash" : ""}`}>
                        <td className={`num text-xs sm:py-2 sm:pr-2 sm:align-top ${p.date === "Today" ? "font-black text-ink" : "text-muted"}`}>{p.date}</td>
                        <td className="min-w-0 sm:py-2 sm:pr-2 sm:align-top">
                          <p className="font-bold leading-tight">{p.vendor}</p>
                          <p className="text-xs text-muted">{p.concept} · {p.invoice}</p>
                        </td>
                        <td className="col-start-2 row-start-2 sm:py-2 sm:pr-2 sm:align-top">
                          <RuleBadge rule={p.rule} />
                        </td>
                        <td className="num col-start-3 row-start-1 text-right font-black whitespace-nowrap sm:py-2 sm:align-top">{pesos(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Link href="/ledger" className="mt-2 inline-block text-xs font-bold">
                {rows.length > 4 ? `All ${rows.length} payments, with proof, on the public ledger ↗` : "Proof of each one on the public ledger ↗"}
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";
// "Will the robot pay it?": the contract's four checks as meters against their limits.
// Grey is what is already used, blue is this invoice, the ink tick is the limit. Past the tick turns red.
import { useId, useState } from "react";
import { checkRules, initialTreasury, LINE_ORDER, pesos, THRESHOLD, type LineId, type RuleResult, type VendorId } from "./demo-model";

const T = initialTreasury();

function Meter({ r }: { r: RuleResult }) {
  const total = r.used + r.amount;
  const max = Math.max(r.limit, total) * 1.04 || 1;
  const usedPct = (r.used / max) * 100;
  const amountPct = (r.amount / max) * 100;
  const limitPct = (r.limit / max) * 100;
  return (
    <li className="rounded-xl border-2 border-line bg-paper p-2 sm:p-3">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
        <span className="text-xs font-extrabold leading-tight sm:text-sm">{r.label}</span>
        <span className={`flex shrink-0 items-center gap-1 text-xs font-black ${r.ok ? "text-blue-ink" : "text-red-ink"}`}>
          <span aria-hidden="true" className={`grid h-4 w-4 place-items-center rounded-full border-2 border-ink text-[9px] ${r.ok ? "bg-blue text-white" : "bg-red text-white"}`}>
            {r.ok ? "✓" : "×"}
          </span>
          {r.ok ? "Fits" : "Too much"}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${r.label}: ${r.used ? `${pesos(r.used)} already used plus ` : ""}${pesos(r.amount)} against a limit of ${pesos(r.limit)}. ${r.ok ? "Fits" : "Does not fit"}.`}
        title={`${r.used ? `Already used ${pesos(r.used)} · ` : ""}This invoice ${pesos(r.amount)} · Limit ${pesos(r.limit)}`}
        className="relative mt-2 h-3.5"
      >
        <div className="absolute inset-0 rounded-full bg-blue-soft" />
        {r.used > 0 ? <div className="absolute inset-y-0 left-0 rounded-l-full bg-ink/25" style={{ width: `${usedPct}%` }} /> : null}
        <div
          className={`absolute inset-y-0 rounded-r-[4px] transition-[width,left] duration-200 ${r.ok ? "bg-blue" : "bg-red"} ${r.used > 0 ? "" : "rounded-l-full"}`}
          style={{ left: `calc(${usedPct}% + ${r.used > 0 ? 2 : 0}px)`, width: `max(0px, calc(${amountPct}% - ${r.used > 0 ? 2 : 0}px))` }}
        />
        <div className="absolute -inset-y-1 w-[3px] -translate-x-1/2 rounded-full bg-ink" style={{ left: `${limitPct}%` }} />
      </div>
      <p className="num mt-1.5 text-[11px] leading-snug text-muted sm:text-xs">
        {r.used ? `${pesos(r.used)} used + ` : ""}
        <span className="font-bold text-ink">{pesos(r.amount)}</span> of {pesos(r.limit)}
      </p>
    </li>
  );
}

export function RuleCheck() {
  const [amount, setAmount] = useState(28_400);
  const [line, setLine] = useState<LineId>("materiales");
  const [vendor, setVendor] = useState<VendorId>("pepe");
  const { rules, auto } = checkRules(T, { amount, line, vendor });
  const failed = rules.filter((r) => !r.ok);
  const ids = { amount: useId(), line: useId(), vendor: useId() };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <label htmlFor={ids.amount} className="text-xs font-extrabold uppercase tracking-wide text-muted">
            Invoice amount
          </label>
          <p className="text-2xl font-black tracking-tight sm:text-4xl">{pesos(amount)}</p>
          <input
            id={ids.amount}
            type="range"
            min={1_000}
            max={150_000}
            step={500}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="demo-range mt-2 w-full"
          />
          <div className="num flex justify-between text-[11px] text-muted">
            <span>{pesos(1_000)}</span>
            <span>{pesos(150_000)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label htmlFor={ids.line} className="text-xs font-extrabold">
            Budget line
            <select id={ids.line} value={line} onChange={(e) => setLine(e.target.value as LineId)} className="mt-1 block min-h-11 w-full rounded-xl border-[3px] border-ink bg-surface px-2 text-sm font-bold">
              {LINE_ORDER.map((id) => (
                <option key={id} value={id}>
                  {T.lines[id].name}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={ids.vendor} className="text-xs font-extrabold">
            Vendor
            <select id={ids.vendor} value={vendor} onChange={(e) => setVendor(e.target.value as VendorId)} className="mt-1 block min-h-11 w-full rounded-xl border-[3px] border-ink bg-surface px-2 text-sm font-bold">
              {(["pepe", "tornillo"] as VendorId[]).map((id) => (
                <option key={id} value={id}>
                  {T.vendors[id].name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div role="status" className={`rounded-2xl border-[3px] border-ink p-3 shadow-hard-xs ${auto ? "bg-blue text-white" : "bg-yellow text-ink"}`}>
          <p className="text-lg font-black leading-tight">{auto ? "The robot pays it on the spot." : `It waits for ${THRESHOLD} people to sign.`}</p>
          <p className={`mt-1 text-sm ${auto ? "text-white/90" : "text-ink/80"}`}>
            {auto ? "All four checks pass, so the contract lets the agent pay. The auditor is told as it happens." : `It's ${failed.map((r) => r.why).join(", and ")}. Two signers approve it with their fingerprint, or it never goes out.`}
          </p>
        </div>

        <div>
          <p className="text-xs font-extrabold">And no matter the amount, it can never</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {["pay a vendor that's not on the list", "change budgets, caps or signers alone", "pay itself", "keep paying after a pause"].map((t) => (
              <li key={t} className="flex items-center gap-1.5 rounded-full border-2 border-line bg-paper px-2.5 py-1 text-xs font-semibold">
                <span aria-hidden="true" className="grid h-4 w-4 place-items-center rounded-full bg-red text-[9px] font-black text-white">×</span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-bold text-muted" aria-hidden="true">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-ink/25" /> Already used</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-blue" /> This invoice</span>
          <span className="flex items-center gap-1.5"><span className="h-3.5 w-[3px] rounded-full bg-ink" /> Limit</span>
        </div>
        <ul className="grid grid-cols-2 gap-1.5 sm:gap-2">
          {rules.map((r) => (
            <Meter key={r.id} r={r} />
          ))}
        </ul>
      </div>
    </div>
  );
}

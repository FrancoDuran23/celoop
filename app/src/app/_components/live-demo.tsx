"use client";
// A scripted Telegram chat with the treasurer bot, next to the public ledger it moves.
// The model (demo-model.ts) decides everything; this file only reveals it at reading pace.
import { useEffect, useMemo, useRef, useState } from "react";
import { Robot } from "@/components/Brand";
import { initialTreasury, LINE_ORDER, pesos, play, SCENARIOS, THRESHOLD, type LedgerEvent, type Msg, type Treasury } from "./demo-model";
import { useAutoplay } from "./use-autoplay";

const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function delayFor(m: Msg) {
  if (reduceMotion()) return 0;
  if (m.from === "bot") return 550 + Math.min(900, m.text.length * 5);
  if (m.from === "system") return 450;
  return 120;
}

// What each person taps, in order. The animation presses these by itself.
const PICKS: Record<string, string[]> = {
  contribute: ["Contribute", "$ 5.000", "Pay from my bank app"],
  small: ["Upload invoice", "Send the photo", "Materiales (suggested)"],
  big: ["Upload invoice", "Send the photo", "Mantenimiento (suggested)", "Sign with fingerprint", "Sign with fingerprint"],
  ask: ["Where did the money go?", "Is any line over budget?"],
};

/** The chat plays by itself, situation after situation, and loops. It only runs while on screen. */
export function LiveDemo() {
  // With reduced motion it starts still, showing one whole situation, until the person presses play.
  const { ref: root, playing, frozen, running, toggle } = useAutoplay<HTMLDivElement>();
  const [indexState, setIndex] = useState(0);
  const [base, setBase] = useState<Treasury>(initialTreasury);
  const [stepState, setStep] = useState(0);
  const [shownState, setShown] = useState(0);
  const [pressed, setPressed] = useState<string | null>(null);
  const index = frozen ? 2 : indexState;
  const step = frozen ? PICKS.big.length : stepState;
  const shown = frozen ? Number.MAX_SAFE_INTEGER : shownState;
  const log = useRef<HTMLDivElement>(null);

  const scenario = SCENARIOS[index];
  const picks = PICKS[scenario.id];
  const frame = useMemo(() => play(scenario, picks.slice(0, step), base), [scenario, picks, step, base]);
  const revealing = shown < frame.messages.length;
  const typing = revealing && frame.messages[shown].from === "bot";
  const treasury = shown === 0 ? base : frame.states[Math.min(shown, frame.states.length) - 1];

  // Reveal the next message at reading pace.
  useEffect(() => {
    if (!running || !revealing) return;
    const timer = setTimeout(() => setShown((n) => n + 1), delayFor(frame.messages[shown]));
    return () => clearTimeout(timer);
  }, [running, revealing, shown, frame.messages]);

  // Once everything is on screen: press the next button, or move on to the next situation.
  useEffect(() => {
    if (!running || revealing) return;
    if (frame.prompt.kind === "choice") {
      const pick = picks[step] ?? frame.prompt.options[0];
      const press = setTimeout(() => setPressed(pick), 700);
      const send = setTimeout(() => {
        setPressed(null);
        setStep((n) => n + 1);
      }, 1300);
      return () => {
        clearTimeout(press);
        clearTimeout(send);
      };
    }
    const next = setTimeout(() => {
      const nextIndex = (index + 1) % SCENARIOS.length;
      setBase(nextIndex === 0 ? initialTreasury() : frame.treasury);
      setIndex(nextIndex);
      setStep(0);
      setShown(0);
    }, 2800);
    return () => clearTimeout(next);
  }, [running, revealing, frame, picks, step, index]);

  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion() ? "auto" : "smooth" });
  }, [shown, typing]);

  return (
    <div ref={root}>
      <div className="flex items-center gap-2">
        <ol aria-label="Situations" className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1">
          {SCENARIOS.map((s, i) => (
            <li
              key={s.id}
              aria-current={i === index ? "step" : undefined}
              className={`shrink-0 rounded-full border-2 px-2.5 py-1 text-xs font-extrabold transition-colors ${
                i === index ? "border-ink bg-yellow shadow-hard-xs" : i < index ? "border-line bg-paper text-ink" : "border-line bg-surface text-muted"
              }`}
            >
              {s.title}
            </li>
          ))}
        </ol>
        <button
          onClick={toggle}
          aria-pressed={!playing}
          className="press shrink-0 rounded-lg border-2 border-ink bg-surface px-2.5 py-1 text-xs font-extrabold"
        >
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-4">
        <div className="min-w-0 overflow-hidden rounded-2xl border-[3px] border-ink bg-[#e8edf2]" aria-label={`Chat between ${scenario.who} and the Minga bot`}>
          <div className="flex items-center gap-2.5 border-b-[3px] border-ink bg-surface px-3 py-2">
            <Robot size={34} hue="yellow" />
            <div className="min-w-0 leading-tight">
              <p className="text-sm font-black">Minga</p>
              <p className="truncate text-xs text-muted">
                bot · chatting with {scenario.who}, {scenario.role.toLowerCase()}
              </p>
            </div>
          </div>

          <div ref={log} role="log" aria-live="off" className="flex h-[290px] flex-col gap-2 overflow-y-auto px-3 py-3 sm:h-[360px] [&>*]:shrink-0">
            {frame.messages.slice(0, shown).map((m, i) => (
              <Bubble key={`${scenario.id}-${i}`} m={m} />
            ))}
            {typing && running ? (
              <div className="w-fit rounded-2xl rounded-tl-md border-2 border-ink bg-surface px-3 py-2" aria-hidden="true">
                <span className="demo-dots">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            ) : null}
          </div>

          <div className="min-h-[56px] border-t-[3px] border-ink bg-surface p-2" aria-hidden="true">
            {!revealing && frame.prompt.kind === "choice" ? (
              <div className={`grid gap-1.5 ${frame.prompt.options.length > 1 ? "grid-cols-2" : "grid-cols-1"} ${frame.prompt.options.length === 3 ? "sm:grid-cols-3" : ""}`}>
                {frame.prompt.options.map((o) => (
                  <span
                    key={o}
                    className={`grid min-h-10 place-items-center rounded-xl border-2 border-ink px-2 text-center text-xs font-extrabold transition-all duration-150 ${
                      pressed === o ? "translate-x-[2px] translate-y-[2px] bg-blue text-white" : "bg-blue-soft shadow-hard-xs"
                    }`}
                  >
                    {o}
                  </span>
                ))}
              </div>
            ) : (
              <p className="py-2.5 text-center text-xs text-muted">{revealing ? "…" : "Next situation in a moment"}</p>
            )}
          </div>
        </div>

        <Ledger t={treasury} />
      </div>
      <p className="mt-2 text-xs text-muted">The real bot speaks Spanish, like the families. Names and amounts come from the demo co-op.</p>
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  if (m.from === "system") {
    return <p className="mx-auto w-fit rounded-full bg-ink/10 px-3 py-1 text-center text-[11px] font-bold text-ink/70">{m.text}</p>;
  }
  if (m.from === "user") {
    return (
      <div className="demo-in ml-auto max-w-[85%] rounded-2xl rounded-tr-md border-2 border-ink bg-blue px-3 py-2 text-sm font-semibold text-white">
        {m.file ? (
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="grid h-8 w-7 shrink-0 place-items-center rounded-md border-2 border-white/80 bg-white/15 text-[10px] font-black">PDF</span>
            <span className="leading-snug">{m.text}</span>
          </span>
        ) : (
          m.text
        )}
      </div>
    );
  }
  return (
    <div className="demo-in max-w-[88%] overflow-hidden rounded-2xl rounded-tl-md border-2 border-ink bg-surface text-sm">
      <p className="whitespace-pre-line px-3 py-2 leading-snug">{m.text}</p>
      {m.action ? <p className="border-t-2 border-line px-3 py-1.5 text-center text-xs font-extrabold text-blue-ink">{m.action} ↗</p> : null}
    </div>
  );
}

const EVENT_ICON: Record<LedgerEvent["kind"], { glyph: string; cls: string; label: string }> = {
  in: { glyph: "+", cls: "bg-blue text-white", label: "Money in" },
  auto: { glyph: "✓", cls: "bg-yellow text-ink", label: "Paid automatically" },
  signed: { glyph: "✓✓", cls: "bg-yellow text-ink", label: "Paid with signatures" },
  wait: { glyph: "…", cls: "bg-paper text-ink", label: "Waiting" },
  rejected: { glyph: "×", cls: "bg-red text-white", label: "Rejected" },
};

function Ledger({ t }: { t: Treasury }) {
  const start = initialTreasury();
  const delta = t.balance - start.balance;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-2xl border-[3px] border-ink bg-surface p-3 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-blue-ink">
            <span className="demo-live h-2 w-2 rounded-full bg-red" aria-hidden="true" /> Public ledger
          </p>
          <p key={t.balance} className="demo-flash mt-1 text-2xl font-black tracking-tight sm:text-4xl">{pesos(t.balance)}</p>
          <p className="text-xs text-muted">
            Balance{delta !== 0 ? ` · ${delta > 0 ? "+" : ""}${pesos(delta)} since you started` : ""} · {t.contributions} contributions, no names
          </p>
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-extrabold">Budget lines</p>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-1">
          {LINE_ORDER.map((id) => {
            const l = t.lines[id];
            const over = l.spent > l.allocated;
            const pct = Math.min(100, (l.spent / l.allocated) * 100);
            return (
              <li key={id}>
                <div className="flex flex-col text-xs sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                  <span className="font-bold">
                    {l.name}
                    {over ? <span className="ml-1.5 rounded border-2 border-ink bg-red px-1 text-[10px] font-black uppercase text-white">! Over</span> : null}
                  </span>
                  <span className="num text-[11px] text-muted sm:text-xs">
                    {pesos(l.spent)} / {pesos(l.allocated)}
                  </span>
                </div>
                <div
                  role="img"
                  aria-label={`${l.name}: ${pesos(l.spent)} spent of ${pesos(l.allocated)}${over ? ", over budget" : ""}`}
                  title={`${l.name}: ${pesos(l.spent)} of ${pesos(l.allocated)}`}
                  className="mt-1 h-2.5 overflow-hidden rounded-full bg-blue-soft"
                >
                  <div className={`h-full rounded-r-[4px] transition-[width] duration-500 ${over ? "bg-red" : "bg-blue"}`} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {t.pending.length ? (
        <div className="rounded-xl border-2 border-ink bg-yellow-soft p-2.5">
          <p className="text-xs font-extrabold">Waiting for signatures</p>
          {t.pending.map((p) => (
            <div key={p.id} className="mt-1 flex items-center justify-between gap-2 text-xs">
              <span className="truncate">
                {t.vendors[p.vendor].name} · {pesos(p.amount)}
              </span>
              <span className="flex shrink-0 items-center gap-1 font-bold" aria-label={`${p.approvals} of ${THRESHOLD} signatures`}>
                {Array.from({ length: THRESHOLD }, (_, i) => (
                  <span key={i} className={`h-3 w-3 rounded-full border-2 border-ink ${i < p.approvals ? "bg-ink" : "bg-surface"}`} />
                ))}
                {p.approvals} of {THRESHOLD}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <p className="mb-1.5 text-xs font-extrabold">Latest movements</p>
        {t.events.length === 0 ? (
          <p className="text-xs text-muted">Nothing yet. Start a chat and watch this side.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 [&>li:nth-child(n+3)]:hidden sm:[&>li:nth-child(n+3)]:flex">
            {t.events.slice(0, 4).map((e, i) => {
              const icon = EVENT_ICON[e.kind];
              const out = e.kind === "auto" || e.kind === "signed";
              return (
                <li key={e.id} className={`flex items-center gap-2 rounded-lg border-2 px-2 py-1.5 text-xs ${i === 0 ? "demo-flash border-ink" : "border-line"}`}>
                  <span aria-label={icon.label} className={`grid h-6 w-7 shrink-0 place-items-center rounded-md border-2 border-ink text-[11px] font-black ${icon.cls}`}>
                    {icon.glyph}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{e.text}</span>
                  <span className="num shrink-0 font-bold">
                    {e.kind === "in" ? "+" : out ? "−" : ""}
                    {pesos(e.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";

type Tone = "warn" | "danger" | "ok" | "neutral";

const BANNER: Record<Exclude<Tone, "neutral">, string> = {
  warn: "border-ink bg-yellow text-ink",
  danger: "border-ink bg-red text-white",
  ok: "border-ink bg-blue text-white",
};

/** A full-width message in one of the brand colours. */
export function Banner({ tone = "warn", children }: { tone?: Exclude<Tone, "neutral">; children: ReactNode }) {
  return (
    <div role="status" className={`rounded-2xl border-[3px] px-4 py-3 text-base font-bold shadow-hard-sm ${BANNER[tone]}`}>
      {children}
    </div>
  );
}

const TAG: Record<Tone, string> = {
  neutral: "border-ink bg-paper text-ink",
  warn: "border-ink bg-yellow text-ink",
  danger: "border-ink bg-red text-white",
  ok: "border-ink bg-blue text-white",
};

/** Small label next to an amount or a row. */
export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block rounded-md border-2 px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide ${TAG[tone]}`}>{children}</span>;
}

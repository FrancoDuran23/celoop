import type { ReactNode } from "react";

export function Banner({ tone = "warn", children }: { tone?: "warn" | "danger" | "ok"; children: ReactNode }) {
  const styles = {
    warn: "border-warn bg-warn-soft text-warn",
    danger: "border-danger bg-danger-soft text-danger",
    ok: "border-ok bg-ok-soft text-ok",
  }[tone];
  return (
    <div role="status" className={`rounded-lg border px-4 py-3 text-base font-medium ${styles}`}>
      {children}
    </div>
  );
}

/** Small label next to an amount or a row. */
export function Tag({ tone = "neutral", children }: { tone?: "neutral" | "warn" | "danger" | "ok"; children: ReactNode }) {
  const styles = {
    neutral: "border-line bg-background text-muted",
    warn: "border-warn bg-warn-soft text-warn",
    danger: "border-danger bg-danger-soft text-danger",
    ok: "border-ok bg-ok-soft text-ok",
  }[tone];
  return <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

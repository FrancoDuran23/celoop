// Presentational pieces shared by /firmar and /proveedor. No state, safe on server and client.
import type { ReactNode } from "react";
import { Robot } from "@/components/Brand";

export function PageTitle({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) {
  return (
    <header className="mb-5 flex items-start gap-3">
      <Robot size={44} hue="yellow" className="mt-1 shrink-0" />
      <div>
        {eyebrow ? <p className="text-sm font-extrabold uppercase tracking-wide text-blue-ink">{eyebrow}</p> : null}
        <h1 className="mt-0.5 text-2xl font-black leading-tight tracking-tight text-balance">{children}</h1>
      </div>
    </header>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border-[3px] border-ink bg-surface p-4 shadow-hard-sm ${className}`}>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b-2 border-line py-2.5 last:border-0">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-semibold break-words">{children}</dd>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "ok" | "error"; children: ReactNode }) {
  const tones = {
    info: "border-ink bg-paper text-ink",
    warn: "border-ink bg-yellow-soft text-ink",
    ok: "border-ink bg-blue-soft text-ink",
    error: "border-ink bg-red-soft text-red-ink",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border-2 px-4 py-3 text-[15px] leading-snug ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Problem({ title = "We can't open this page", message }: { title?: string; message: string }) {
  return (
    <div className="space-y-4">
      <PageTitle>{title}</PageTitle>
      <Notice tone="warn">{message}</Notice>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <p className="text-sm text-muted">{label}</p>
      <div className="h-8 w-3/4 animate-pulse rounded-lg bg-line" />
      <div className="h-40 animate-pulse rounded-2xl bg-line/60" />
    </div>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
};

export function Button({ children, onClick, disabled, variant = "primary", type = "button" }: ButtonProps) {
  const styles = {
    primary: "bg-blue text-white hover:bg-blue-ink disabled:bg-blue/50",
    secondary: "bg-surface text-ink hover:bg-paper disabled:opacity-50",
    danger: "bg-surface text-red-ink hover:bg-red-soft disabled:opacity-50",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`press flex min-h-12 w-full touch-manipulation items-center justify-center rounded-xl border-[3px] border-ink px-4 text-base font-extrabold shadow-hard-sm select-none disabled:cursor-not-allowed disabled:shadow-none ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

/** "1 of 2 signatures · 1 more needed" */
export function SignatureCount({ approvals, threshold }: { approvals: number; threshold: number }) {
  const missing = Math.max(0, threshold - approvals);
  return (
    <span>
      {approvals} of {threshold} {threshold === 1 ? "signature" : "signatures"}
      <span className="font-normal text-muted">
        {" · "}
        {missing === 0 ? "complete" : `${missing} more needed`}
      </span>
    </span>
  );
}

/** Choice chip used by the radio groups in the propose form. */
export const chip = (selected: boolean) =>
  `flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-[3px] px-3 py-2 text-center text-[15px] leading-tight font-bold ${
    selected ? "border-ink bg-yellow text-ink shadow-hard-xs" : "border-line bg-surface text-ink hover:border-ink"
  }`;

export const field =
  "mt-1 block min-h-12 w-full rounded-xl border-[3px] border-ink bg-surface px-3 text-base font-semibold";
export const label = "block text-sm font-bold";
export const hint = "mt-1 block text-sm font-normal text-muted";

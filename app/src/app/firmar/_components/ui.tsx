// Presentational pieces shared by /firmar and /proveedor. No state, safe on server and client.
import type { ReactNode } from "react";

export function PageTitle({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) {
  return (
    <header className="mb-5">
      {eyebrow ? <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">{eyebrow}</p> : null}
      <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight text-balance">{children}</h1>
    </header>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-black/10 bg-white/60 p-4 dark:border-white/15 dark:bg-white/5 ${className}`}>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-black/5 py-2.5 last:border-0 dark:border-white/10">
      <dt className="shrink-0 text-sm text-black/60 dark:text-white/60">{label}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{children}</dd>
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "ok" | "error"; children: ReactNode }) {
  const tones = {
    info: "border-sky-700/20 bg-sky-50 text-sky-950 dark:border-sky-300/20 dark:bg-sky-950/40 dark:text-sky-100",
    warn: "border-amber-700/25 bg-amber-50 text-amber-950 dark:border-amber-300/20 dark:bg-amber-950/40 dark:text-amber-100",
    ok: "border-emerald-700/25 bg-emerald-50 text-emerald-950 dark:border-emerald-300/20 dark:bg-emerald-950/40 dark:text-emerald-100",
    error: "border-red-700/25 bg-red-50 text-red-950 dark:border-red-300/20 dark:bg-red-950/40 dark:text-red-100",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-[15px] leading-snug ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Problem({ title = "No podemos abrir esta página", message }: { title?: string; message: string }) {
  return (
    <div className="space-y-4">
      <PageTitle>{title}</PageTitle>
      <Notice tone="warn">{message}</Notice>
    </div>
  );
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <p className="text-sm text-black/60 dark:text-white/60">{label}</p>
      <div className="h-8 w-3/4 animate-pulse rounded-lg bg-black/10 dark:bg-white/10" />
      <div className="h-40 animate-pulse rounded-2xl bg-black/5 dark:bg-white/5" />
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
    primary: "bg-emerald-700 text-white hover:bg-emerald-800 active:bg-emerald-900 disabled:bg-emerald-700/50",
    secondary: "border border-black/15 bg-transparent hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10 disabled:opacity-50",
    danger: "border border-red-700/30 bg-transparent text-red-800 hover:bg-red-50 dark:border-red-300/30 dark:text-red-200 dark:hover:bg-red-950/40 disabled:opacity-50",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`flex min-h-12 w-full touch-manipulation items-center justify-center rounded-xl px-4 text-base font-semibold transition-colors select-none disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {children}
    </button>
  );
}

/** "1 de 2 firmas · falta 1" */
export function SignatureCount({ approvals, threshold }: { approvals: number; threshold: number }) {
  const missing = Math.max(0, threshold - approvals);
  return (
    <span>
      {approvals} de {threshold} {threshold === 1 ? "firma" : "firmas"}
      <span className="font-normal text-black/60 dark:text-white/60">
        {" · "}
        {missing === 0 ? "completas" : `${missing === 1 ? "falta" : "faltan"} ${missing}`}
      </span>
    </span>
  );
}

import type { ReactNode } from "react";

/** A titled section on a white sheet. */
export function Card({
  title, description, children, id, className = "",
}: { title?: string; description?: string; children: ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={`rounded-lg border border-line bg-surface p-4 sm:p-5 ${className}`}>
      {title ? <h2 className="text-lg font-semibold leading-snug">{title}</h2> : null}
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className={title ? "mt-3" : ""}>{children}</div>
    </section>
  );
}

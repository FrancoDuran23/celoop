import type { ReactNode } from "react";
import { Puzzle, type Hue } from "./Brand";

/** A titled section: white sheet, ink border, hard shadow, a puzzle piece as the bullet. */
export function Card({
  title, description, children, id, className = "", hue = "blue",
}: { title?: string; description?: string; children: ReactNode; id?: string; className?: string; hue?: Hue }) {
  return (
    <section id={id} className={`rounded-2xl border-[3px] border-ink bg-surface p-4 shadow-hard sm:p-5 ${className}`}>
      {title ? (
        <h2 className="flex items-center gap-2 text-xl font-extrabold leading-snug">
          <Puzzle hue={hue} size={22} tilt={-8} />
          {title}
        </h2>
      ) : null}
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      <div className={title ? "mt-3" : ""}>{children}</div>
    </section>
  );
}

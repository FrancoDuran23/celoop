// Minga's drawings: a puzzle piece, a round robot and the wordmark. Inline SVG, ink lines, flat fills.
import type { CSSProperties } from "react";

export type Hue = "blue" | "red" | "yellow";

const FILL: Record<Hue, string> = { blue: "var(--blue)", red: "var(--red)", yellow: "var(--yellow)" };

/** A puzzle piece. Rotates a little so a row of them looks hand-placed. */
export function Puzzle({ hue = "blue", size = 28, tilt = 0, className = "" }: { hue?: Hue; size?: number; tilt?: number; className?: string }) {
  const style: CSSProperties = tilt ? { transform: `rotate(${tilt}deg)` } : {};
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 48 48" className={className} style={style}>
      <path
        d="M10 8h11a5 5 0 1 1 6 0h11v11a5 5 0 1 1 0 6v11H27a5 5 0 1 1-6 0H10V25a5 5 0 1 1 0-6V8z"
        fill={FILL[hue]}
        stroke="var(--ink)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The treasurer robot as an avatar, drawn like the robots in the illustration: cream head, headphone ears, dot eyes, a small smile. `hue` colors the ears. */
export function Robot({ size = 64, hue = "yellow", className = "" }: { size?: number; hue?: Hue; className?: string }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64" className={className}>
      <line x1="32" y1="5" x2="32" y2="13" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="5" r="3.5" fill="var(--ink)" />
      <ellipse cx="9.5" cy="34" rx="5" ry="8" fill={FILL[hue]} stroke="var(--ink)" strokeWidth="3" />
      <ellipse cx="54.5" cy="34" rx="5" ry="8" fill={FILL[hue]} stroke="var(--ink)" strokeWidth="3" />
      <path d="M32 12c14 0 21 6 21 19 0 15-8 21-21 21S11 46 11 31c0-13 7-19 21-19z" fill="#f3ecdf" stroke="var(--ink)" strokeWidth="3.5" />
      <ellipse cx="25.5" cy="30" rx="2.4" ry="3.2" fill="var(--ink)" />
      <ellipse cx="38.5" cy="30" rx="2.4" ry="3.2" fill="var(--ink)" />
      <path d="M27 39q5 4 10 0" fill="none" stroke="var(--ink)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** Sparkle lines, like the ones around the name in the drawing. */
export function Sparks({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" className={className} fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round">
      <line x1="20" y1="4" x2="20" y2="12" />
      <line x1="6" y1="12" x2="12" y2="17" />
      <line x1="34" y1="12" x2="28" y2="17" />
    </svg>
  );
}

/** Wordmark with the piece in front. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Puzzle hue="blue" size={compact ? 26 : 34} tilt={-8} />
      <span className={`font-black lowercase tracking-tight ${compact ? "text-2xl" : "text-3xl"}`}>minga</span>
    </span>
  );
}

"use client";
// The robot in the empty space beside each card, drawn like the ones in the illustration: cream
// rounded head, headphone ears, dot eyes, a small smile, a black body. It blinks, floats a little,
// follows the pointer with its eyes and reacts when the pointer reaches it. Decorative only.
import { useEffect, useRef, useState, type CSSProperties } from "react";

export type WatcherKind = "magnifier" | "tablet" | "plain";

const INK = "var(--ink)";
const CREAM = "#f3ecdf";

export function Watcher({ kind, faces, delay = 0 }: { kind: WatcherKind; faces: "left" | "right"; delay?: number }) {
  const root = useRef<HTMLDivElement>(null);
  const pupils = useRef<SVGGElement>(null);
  const [happy, setHappy] = useState(false);

  useEffect(() => {
    const el = root.current;
    const eyes = pupils.current;
    if (!el || !eyes || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const look = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height * 0.4);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 260);
      const tx = (dx / d) * 4 * k;
      const ty = (dy / d) * 3 * k;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        eyes.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)`;
      });
    };
    const onPointer = (e: PointerEvent) => look(e.clientX, e.clientY);
    window.addEventListener("pointermove", onPointer, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // The robot is drawn facing right; mirror it when the card is on its left.
  const mirror = faces === "left";
  const yellow = kind === "tablet";
  const head = yellow ? "var(--yellow)" : CREAM;
  const body = yellow ? "var(--yellow)" : INK;

  return (
    <div
      ref={root}
      aria-hidden="true"
      onPointerEnter={() => setHappy(true)}
      onPointerLeave={() => setHappy(false)}
      className={`watcher watcher-${kind} ${happy ? "is-happy" : ""}`}
      style={{ "--delay": `${delay}s` } as CSSProperties}
    >
      <svg viewBox="0 0 172 150" width="146" height="128" style={mirror ? { transform: "scaleX(-1)" } : undefined}>
        <g className="watcher-body">
          {/* body: a bust, like the figures in the picture */}
          <path d="M28 150V122c0-16 12-26 30-27h34c18 1 30 11 30 27v28z" fill={body} stroke={INK} strokeWidth="5" strokeLinejoin="round" />
          {/* antenna */}
          <g className="watcher-antenna">
            <line x1="75" y1="10" x2="75" y2="27" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
            <circle cx="75" cy="9" r="6.5" fill={INK} />
          </g>
          {/* headphone ears */}
          <path d="M38 50a14 16 0 0 0 0 30" fill={CREAM} stroke={INK} strokeWidth="5" strokeLinecap="round" />
          <path d="M112 50a14 16 0 0 1 0 30" fill={CREAM} stroke={INK} strokeWidth="5" strokeLinecap="round" />
          <ellipse cx="34" cy="65" rx="9" ry="14" fill={CREAM} stroke={INK} strokeWidth="5" />
          <ellipse cx="116" cy="65" rx="9" ry="14" fill={CREAM} stroke={INK} strokeWidth="5" />
          {/* head */}
          <path d="M75 26c25 0 39 11 39 34 0 26-14 37-39 37S36 86 36 60c0-23 14-34 39-34z" fill={head} stroke={INK} strokeWidth="5.5" />
          {/* eyes: the pupils follow the pointer, the lids blink */}
          <g className="watcher-lids">
            <g ref={pupils} style={{ transform: "translate(3px, 1px)", transition: "transform 120ms ease-out" }}>
              <ellipse cx="63" cy="58" rx="4" ry="5.5" fill={INK} />
              <ellipse cx="87" cy="58" rx="4" ry="5.5" fill={INK} />
            </g>
          </g>
          {/* smile, a little wider when the pointer arrives */}
          <path d={happy ? "M64 73q11 10 22 0" : "M67 74q8 6 16 0"} fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />

          {kind === "magnifier" ? (
            <g className="watcher-tool">
              {/* no arm: a small hand holding the magnifying glass up toward the card */}
              <line x1="131" y1="96" x2="140" y2="78" stroke={INK} strokeWidth="7" strokeLinecap="round" />
              <circle cx="130" cy="98" r="6" fill={CREAM} stroke={INK} strokeWidth="3.5" />
              <circle cx="149" cy="60" r="19" fill="rgb(255 255 255 / 0.6)" stroke={INK} strokeWidth="6.5" />
              <path d="M139 52a12 12 0 0 1 11-7" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" />
            </g>
          ) : kind === "tablet" ? (
            <g className="watcher-tool">
              {/* holding a tablet, like the yellow robot */}
              <rect x="80" y="104" width="44" height="32" rx="4" fill={INK} stroke={INK} strokeWidth="4" transform="rotate(-12 102 120)" />
              <path d="M88 110l30-6" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
              <circle cx="84" cy="128" r="6" fill={CREAM} stroke={INK} strokeWidth="3.5" />
              <circle cx="122" cy="118" r="6" fill={CREAM} stroke={INK} strokeWidth="3.5" />
            </g>
          ) : null}
        </g>
      </svg>
    </div>
  );
}

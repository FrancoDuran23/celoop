// How the money moves, as a diagram: left to right on wide screens, top to bottom on phones.
// The robot's check splits into the two real outcomes and both end on the public ledger.
import type { ReactNode } from "react";
import { Robot } from "@/components/Brand";

const stroke = { fill: "none", stroke: "var(--ink)", strokeWidth: 2.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const ICONS: Record<string, ReactNode> = {
  phone: (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
      <rect x="9" y="3" width="14" height="26" rx="3" {...stroke} fill="var(--surface)" />
      <path d="M13 9h6M13 13h4" {...stroke} />
      <circle cx="16" cy="24" r="1.5" fill="var(--ink)" />
    </svg>
  ),
  lock: (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
      <rect x="6" y="14" width="20" height="14" rx="3" {...stroke} fill="var(--surface)" />
      <path d="M11 14v-4a5 5 0 0 1 10 0v4" {...stroke} />
      <path d="M16 19v4" {...stroke} />
    </svg>
  ),
  invoice: (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
      <path d="M8 3h12l5 5v21H8z" {...stroke} fill="var(--surface)" />
      <path d="M12 13h9M12 17h9M12 21h5" {...stroke} />
      <rect x="18" y="20" width="4" height="4" fill="var(--ink)" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden="true">
      <path d="M7 17l6 6 12-13" {...stroke} strokeWidth={3.5} stroke="white" />
    </svg>
  ),
  pens: (
    <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden="true">
      <path d="M5 25l3-8 11-11 5 5-11 11z" {...stroke} fill="var(--surface)" />
      <path d="M17 8l5 5" {...stroke} />
      <path d="M5 29h22" {...stroke} />
    </svg>
  ),
  eye: (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
      <path d="M3 16s5-9 13-9 13 9 13 9-5 9-13 9S3 16 3 16z" {...stroke} fill="var(--surface)" />
      <circle cx="16" cy="16" r="4" fill="var(--ink)" />
    </svg>
  ),
};

function Station({ n, icon, bg, title, who, text }: { n: number; icon: ReactNode; bg: string; title: string; who: string; text: string }) {
  return (
    <li className="flex min-w-0 flex-1 items-start gap-3 lg:flex-col lg:items-center lg:text-center">
      <span className="relative shrink-0">
        <span className={`grid h-11 w-11 place-items-center rounded-xl border-[3px] border-ink shadow-hard-xs sm:h-14 sm:w-14 sm:rounded-2xl ${bg}`}>{icon}</span>
        <span className="num absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full border-2 border-ink bg-surface text-[11px] font-black">{n}</span>
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-extrabold uppercase tracking-wide text-blue-ink">{who}</span>
        <span className="block text-sm font-black leading-tight sm:text-base">{title}</span>
        <span className="mt-0.5 hidden text-xs leading-snug text-muted sm:block">{text}</span>
      </span>
    </li>
  );
}

function Arrow() {
  return (
    <li aria-hidden="true" className="flex shrink-0 justify-start pl-3.5 sm:pl-5 lg:items-center lg:justify-center lg:self-start lg:pl-0 lg:pt-5">
      <svg viewBox="0 0 40 16" className="h-3 w-5 rotate-90 sm:h-4 sm:w-8 lg:h-3 lg:w-6 lg:rotate-0">
        <path d="M2 8h32M28 3l6 5-6 5" fill="none" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </li>
  );
}

function Outcome({ icon, bg, title, text }: { icon: ReactNode; bg: string; title: string; text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border-2 border-ink bg-surface p-2">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border-2 border-ink ${bg}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-black leading-tight">{title}</span>
        <span className="block text-[11px] leading-snug text-muted">{text}</span>
      </span>
    </div>
  );
}

export function Flow() {
  return (
    <ol className="flex flex-col gap-1 lg:flex-row lg:items-start lg:gap-2">
      <Station n={1} icon={ICONS.phone} bg="bg-blue" who="Families" title="Chip in from the chat" text="Any amount, in pesos. A receipt in a minute." />
      <Arrow />
      <Station n={2} icon={ICONS.lock} bg="bg-blue-soft" who="The contract" title="Holds the money" text="Not in anyone's account. Readable by anyone." />
      <Arrow />
      <Station n={3} icon={ICONS.invoice} bg="bg-yellow" who="The board" title="Sends an invoice photo" text="Nobody on the board touches the money." />
      <Arrow />
      <Station n={4} icon={<Robot size={40} hue="yellow" />} bg="bg-surface" who="The robot" title="Checks four rules" text="Cap per payment, room in the line, vendor cap, balance." />
      <Arrow />
      <li className="grid min-w-0 flex-[1.3] grid-cols-2 gap-1.5 lg:grid-cols-1">
        <Outcome icon={ICONS.check} bg="bg-blue" title="Fits: paid now" text="The vendor gets it on the spot." />
        <Outcome icon={ICONS.pens} bg="bg-yellow" title="Too big: 2 signers" text="Approved with a fingerprint, or never paid." />
      </li>
      <Arrow />
      <Station n={5} icon={ICONS.eye} bg="bg-red" who="Everyone" title="Sees it on the ledger" text="Every invoice, plus a monthly report the auditor signs off." />
    </ol>
  );
}

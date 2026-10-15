import Image from "next/image";
import Link from "next/link";
import { Puzzle, Sparks, type Hue } from "@/components/Brand";
import { APP_NAME } from "@/lib/brand";
import { Flow } from "./_components/flow";
import { LiveDemo } from "./_components/live-demo";
import { RuleCheck } from "./_components/rule-check";
import { ScrollHint } from "./_components/scroll-hint";
import { Spending } from "./_components/spending";
import { Watcher, type WatcherKind } from "./_components/watcher";
import hero from "../../public/minga-hero.webp";

const button =
  "press inline-flex min-h-11 items-center justify-center rounded-xl border-[3px] border-ink px-4 text-sm font-extrabold no-underline shadow-hard-sm sm:min-h-12 sm:px-5 sm:text-base";

/** One width for every card on the page. */
const CARD = "w-full max-w-5xl";
const SIDE = { left: "mx-auto lg:ml-0 lg:mr-auto", right: "mx-auto lg:mr-0 lg:ml-auto" } as const;

/**
 * A white card. Every card is the same width; `side` alternates them on wide screens, and a robot
 * watches from the free space on the other side (only where that space exists, xl and up).
 */
function Panel({ id, children, interactive, side, robot, delay = 0 }: { id?: string; children: React.ReactNode; interactive?: boolean; side: "left" | "right"; robot?: WatcherKind; delay?: number }) {
  return (
    <section
      id={id}
      data-interactive={interactive ? "" : undefined}
      className={`${CARD} ${SIDE[side]} relative scroll-mt-24 rounded-2xl border-[3px] border-ink bg-surface p-4 leading-snug shadow-hard sm:rounded-3xl sm:p-6`}
    >
      {children}
      {robot ? (
        <div
          data-decor
          className={`watcher-bob absolute top-1/2 hidden -translate-y-1/2 overflow-hidden rounded-[42%] border-[3px] border-ink bg-paper px-1 pt-1 shadow-hard-sm xl:block ${side === "left" ? "left-full ml-6" : "right-full mr-6"}`}
          style={{ "--delay": `${delay}s` } as React.CSSProperties}
        >
          <Watcher kind={robot} faces={side === "left" ? "left" : "right"} delay={delay} />
        </div>
      ) : null}
    </section>
  );
}

function Title({ hue, children, lead }: { hue: Hue; children: React.ReactNode; lead?: string }) {
  return (
    <div className="mb-3 sm:mb-4">
      <h2 className="flex items-center gap-2 text-xl font-black tracking-tight sm:gap-3 sm:text-3xl short:text-2xl">
        <Puzzle hue={hue} size={28} tilt={-8} className="shrink-0" />
        {children}
      </h2>
      {lead ? <p className="mt-1 text-[13px] text-muted sm:text-base">{lead}</p> : null}
    </div>
  );
}

const STACK: Array<[string, string]> = [
  ["Celo + wARS", "pesos on chain, no gas to think about"],
  ["Policy contract", "holds the funds, enforces every rule"],
  ["Passkeys", "a fingerprint instead of a seed phrase"],
  ["ERC-8004 agent", "an identity anyone can check"],
];

export default function Landing() {
  return (
    <>
      {/* The illustration stays behind the whole page, still. */}
      <div className="fixed inset-0 z-0 bg-paper" aria-hidden="true">
        <Image src={hero} alt="" fill priority sizes="100vw" className="object-cover" />
      </div>
      <ScrollHint />

      <main className="relative z-10 mx-auto flex max-w-6xl flex-col gap-[12vh] px-3 pb-[16vh] sm:gap-[16vh] sm:px-8 lg:px-12 xl:max-w-7xl">
        {/* The first screen is the picture alone. */}
        <div className="h-[58svh]" aria-hidden="true" />

        <Panel id="top" side="left" robot="plain">
          <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-blue-ink sm:text-sm">
            <Sparks className="-ml-2 h-6 w-6 sm:h-7 sm:w-7" /> Community AI for school co-ops
          </p>
          <h1 className="mt-2 max-w-3xl text-3xl font-black leading-[1.05] tracking-tight text-balance sm:text-5xl short:text-4xl">
            The money of a school co-op, in the open, with a robot that never spends alone.
          </h1>
          <p className="mt-3 max-w-3xl text-base text-muted sm:text-lg">
            Today one or two volunteers handle it with cash, a bank account and a spreadsheet. {APP_NAME} is a treasurer that lives in
            Telegram: families contribute from a chat, bills get paid by rule, big ones wait for signatures, and every peso is public.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2 sm:gap-3">
            <a href="#spending" className={`${button} bg-blue text-white hover:bg-blue-ink hover:text-white`}>
              See where the money goes
            </a>
            <Link href="/ledger" className={`${button} bg-yellow text-ink hover:bg-yellow-soft hover:text-ink`}>
              Open the live ledger
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted sm:text-sm">Minga: an Andean word for the whole community showing up to get a job done together.</p>
        </Panel>

        <Panel id="spending" interactive side="right" robot="magnifier" delay={1.1}>
          <Title hue="red" lead="This is the ledger everyone can see. Movements land as they happen; tap a part of the bar to see each payment behind it.">
            Every peso, in the open
          </Title>
          <Spending />
        </Panel>

        <Panel id="how" side="left" robot="plain" delay={2.3}>
          <Title hue="blue">How {APP_NAME} works</Title>
          <Flow />
          <dl className="mt-4 hidden flex-wrap gap-1.5 border-t-2 border-line pt-3 sm:flex">
            {STACK.map(([term, text]) => (
              <div key={term} className="rounded-full border-2 border-line bg-paper px-3 py-1 text-xs">
                <dt className="inline font-extrabold">{term}</dt>
                <dd className="inline text-muted"> · {text}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel interactive side="right" robot="magnifier" delay={0.6}>
          <Title hue="yellow" lead="Every bill goes through the same four checks in the contract. Move the amount and see which one stops it.">
            Will the robot pay it?
          </Title>
          <RuleCheck />
        </Panel>

        <Panel id="try" interactive side="left" robot="tablet" delay={1.7}>
          <Title hue="blue" lead="Watch a family, the board and two signers use it, one situation after another. The ledger moves with every message.">
            The chat, from the inside
          </Title>
          <LiveDemo />
        </Panel>

        <section className={`minga-band ${CARD} ${SIDE.right} flex flex-col items-start gap-4 rounded-2xl border-[3px] border-ink p-5 leading-snug text-white shadow-hard sm:flex-row sm:items-center sm:justify-between sm:rounded-3xl sm:p-8`}>
          <div>
            <h2 className="text-2xl font-black tracking-tight sm:text-3xl">See it running.</h2>
            <p className="mt-1 text-white/90">The public ledger updates as the money moves. No sign-up, no names.</p>
          </div>
          <Link href="/ledger" className={`${button} bg-yellow text-ink hover:bg-yellow-soft hover:text-ink`}>
            Open the ledger
          </Link>
        </section>
      </main>
    </>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { Banner } from "@/components";
import { Button, Loading, PageTitle, field, hint, label } from "@/app/firmar/_components/ui";
import { startCooperativa } from "@/lib/onboarding/actions";

export const metadata: Metadata = { title: "Start a co-op" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function StartPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<Loading label="Loading…" />}>
      <StartForm searchParams={searchParams} />
    </Suspense>
  );
}

async function StartForm({ searchParams }: Props) {
  const error = (await searchParams).error;
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-8">
      <PageTitle eyebrow="Minga">Open an account for your co-op</PageTitle>
      <p className="mb-5 text-[15px] leading-relaxed text-muted">
        Any school co-op can sign up. You invite the people who sign, set the caps and the budget lines, and Minga
        deploys that co-op’s treasury on Celo. The live demo stays on the ledger.
      </p>
      {message ? (
        <div className="mb-4">
          <Banner tone="warn">{message}</Banner>
        </div>
      ) : null}
      <form action={startCooperativa} className="space-y-4 rounded-2xl border-[3px] border-ink bg-surface p-4 shadow-hard-sm">
        <label className={label}>
          Co-op name
          <input className={field} name="name" required maxLength={120} autoComplete="organization" />
        </label>
        <label className={label}>
          School
          <input className={field} name="school" required maxLength={160} />
        </label>
        <label className={label}>
          CUIT
          <input className={field} name="cuit" required inputMode="numeric" placeholder="30-71234567-8" maxLength={16} />
          <span className={hint}>11 digits, with or without dashes.</span>
        </label>
        <label className={label}>
          RUCE
          <input className={field} name="ruce" maxLength={40} />
          <span className={hint}>Optional registration number.</span>
        </label>
        <label className={label}>
          Your name
          <input className={field} name="organizerName" required maxLength={80} autoComplete="name" />
        </label>
        <label className={label}>
          Your phone
          <input className={field} name="organizerPhone" required placeholder="+5491112345678" autoComplete="tel" />
          <span className={hint}>International format, starting with +.</span>
        </label>
        <Button type="submit">Continue</Button>
      </form>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components";
import { Loading } from "@/app/firmar/_components/ui";
import { formatPesos, shortAddress } from "@/lib/wallet/format";
import { draftSummary, signerLinks } from "@/lib/onboarding/actions";
import { LinkButton } from "../../_components/link-button";

export const metadata: Metadata = { title: "Co-op settings" };

type Props = { params: Promise<{ cooperadoraId: string }> };

export default function SettingsPage({ params }: Props) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-lg px-4 py-8"><Loading label="Loading settings…" /></main>}>
      <Settings params={params} />
    </Suspense>
  );
}

async function Settings({ params }: Props) {
  const { cooperadoraId } = await params;
  if (!/^\d{1,9}$/.test(cooperadoraId)) notFound();
  const id = Number(cooperadoraId);
  const { coop, draft, signers } = await draftSummary(id);
  if (coop.status !== "active" || !coop.treasuryAddress) redirect(`/c/${id}/setup`);
  const ready = signers.filter((s) => s.person.safeAddress).length;

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-8">
      <header>
        <p className="text-sm font-extrabold uppercase tracking-wide text-blue-ink">{coop.school}</p>
        <h1 className="text-2xl font-black">{coop.name}</h1>
        <p className="mt-1 text-sm text-muted">
          Caps, budget lines, vendors and signers change only through a proposal. The signers approve it on chain, the
          same way they approve a payment.
        </p>
      </header>

      <Card title="Treasury" hue="blue">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Address</dt>
            <dd className="font-mono font-extrabold">{shortAddress(coop.treasuryAddress)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Signatures</dt>
            <dd className="font-extrabold">{coop.threshold ?? draft.threshold}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Cap per payment</dt>
            <dd className="font-extrabold">{formatPesos(coop.perTxCap ?? draft.perTxCap)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Monthly vendor cap</dt>
            <dd className="font-extrabold">{formatPesos(coop.vendorMonthlyCap ?? draft.vendorMonthlyCap)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm">
          <Link href="/ledger">Live ledger</Link>
        </p>
      </Card>

      <Card title="Budget lines to propose" description="These amounts were saved at signup. They are not on the treasury until a signer proposes each one." hue="yellow">
        {draft.lines.length === 0 ? (
          <p className="text-sm text-muted">No lines were saved. A signer can still add one from the propose page.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {draft.lines.map((line) => (
              <li key={line.slug} className="flex items-baseline justify-between gap-3">
                <span className="font-extrabold">{line.name}</span>
                <span>
                  {formatPesos(line.allocated)}
                  <span className="text-muted"> · until {new Date(line.periodEnd * 1000).toISOString().slice(0, 10)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Ask the signers" description={`${ready} of ${signers.length} signers can propose. The link opens the propose page for that person.`} hue="red">
        <LinkButton
          label="Create propose links"
          empty="No signer has a passkey yet. Finish setup first."
          load={signerLinks.bind(null, id)}
        />
        <p className="mt-3 text-sm text-muted">
          On that page they can add a budget line, move money between lines, enable a vendor, or change the caps. Their
          signature counts, and the others approve until the threshold is met.
        </p>
      </Card>
    </main>
  );
}

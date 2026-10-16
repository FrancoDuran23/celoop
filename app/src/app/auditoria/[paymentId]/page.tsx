import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/db";
import { Banner, Card, Money, TxLink } from "@/components";
import { loadAuditView } from "@/lib/auditor/view";
import { formatDate } from "@/lib/report/format";

type Props = {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function coopId(raw: string | string[] | undefined): number | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{1,9}$/.test(value)) return undefined;
  return Number(value);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { paymentId } = await params;
  return { title: `Auditor's report · payment ${paymentId}` };
}

async function Audit({ params, searchParams }: Props) {
  const { paymentId } = await params;
  if (!/^\d{1,20}$/.test(paymentId)) notFound();
  const c = coopId((await searchParams).c);
  const v = await loadAuditView(getDb(), BigInt(paymentId), c);
  if (!v) notFound();
  const jsonHref = c != null ? `/auditoria/${v.paymentId}/json?c=${c}` : `/auditoria/${v.paymentId}/json`;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <header>
        <p className="text-sm font-extrabold uppercase tracking-wide text-blue-ink">Auditor report</p>
        <h1 className="text-2xl font-black">Payment #{v.paymentId}</h1>
        <p className="mt-1 text-muted">
          The auditor is a second agent, with its own key. It reviews every payment before it can leave without
          signatures. If something looks off, it holds the payment for the people who sign.
        </p>
      </header>

      {v.verdict === "flagged" ? (
        <Banner tone="warn">Flagged: the payment did not go out on its own. The signers have to decide.</Banner>
      ) : (
        <Banner tone="ok">Reviewed, with nothing to flag.</Banner>
      )}

      <Card title="The payment">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-extrabold">{v.vendor}</span>
          <Money value={v.amount} className="font-extrabold" />
        </div>
        <p className="text-sm text-muted">
          {v.invoice ?? "Voucher not in the system"}
          {v.cuit ? ` · CUIT ${v.cuit}` : ""}
        </p>
        <p className="mt-1 text-sm text-muted">Reviewed on {formatDate(v.checkedAt)}</p>
      </Card>

      <Card title="Findings" description="Any one of these is enough for the payment to need signatures." hue="red">
        {v.observations.length === 0 ? (
          <p className="text-muted">None.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5">
            {v.observations.map((f) => (
              <li key={f.code}>{f.text}</li>
            ))}
          </ul>
        )}
      </Card>

      {v.notes.length > 0 ? (
        <Card title="Notes" description="Context for whoever reads the report. These do not hold the payment." hue="yellow">
          <ul className="list-disc space-y-1 pl-5">
            {v.notes.map((f) => (
              <li key={f.code}>{f.text}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card title="How to verify it" hue="yellow">
        <p className="text-sm">
          The auditor stored this report on the chain by its fingerprint (keccak256). Download{" "}
          <a href={jsonHref}>the report as JSON</a> and hash it. It has to be:
        </p>
        <p className="num mt-2 break-all text-sm">{v.reportHash}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {v.onchain ? (
            v.hashMatches ? (
              <span className="font-extrabold text-blue-ink">It matches the hash on the chain.</span>
            ) : (
              <span className="font-extrabold text-red-ink">It does not match the hash on the chain.</span>
            )
          ) : (
            <span className="text-muted">Not on the chain yet.</span>
          )}
          <TxLink txHash={v.onchain?.txHash} chainId={v.chainId} label="View the auditor's transaction" />
        </div>
      </Card>

      <p className="text-sm">
        <Link href="/">Back to the ledger</Link>
      </p>
    </main>
  );
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<p className="mx-auto max-w-3xl px-4 py-10 text-muted">Loading the report…</p>}>
      <Audit {...props} />
    </Suspense>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Banner, Card } from "@/components";
import { Button, Loading, Notice, field, hint, label } from "@/app/firmar/_components/ui";
import { formatPesos } from "@/lib/wallet/format";
import { SIGNER_ROLE_OPTIONS } from "@/lib/onboarding";
import { deploy, draftSummary, enrollLinks, invite, saveSetup } from "@/lib/onboarding/actions";
import { LinkButton } from "../../_components/link-button";

export const metadata: Metadata = { title: "Set up the co-op" };

const ROLE_LABEL: Record<(typeof SIGNER_ROLE_OPTIONS)[number], string> = {
  presidente: "President",
  tesorero: "Treasurer",
  secretario: "Secretary",
  revisor: "Reviewer",
};

type Props = {
  params: Promise<{ cooperadoraId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function wholePesos(baseUnits: string): string {
  try {
    return (BigInt(baseUnits) / BigInt(10) ** BigInt(18)).toString();
  } catch {
    return "";
  }
}

function dateInput(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

export default function SetupPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<main className="mx-auto max-w-lg px-4 py-8"><Loading label="Loading setup…" /></main>}>
      <Setup params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Setup({ params, searchParams }: Props) {
  const { cooperadoraId } = await params;
  if (!/^\d{1,9}$/.test(cooperadoraId)) notFound();
  const id = Number(cooperadoraId);
  const { coop, draft, signers } = await draftSummary(id);
  const error = (await searchParams).error;
  const message = Array.isArray(error) ? error[0] : error;
  const rows = Math.max(draft.lines.length + 1, 3);
  const deployed = coop.status === "active" && Boolean(coop.treasuryAddress);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 py-8">
      <header>
        <p className="text-sm font-extrabold uppercase tracking-wide text-blue-ink">{coop.school}</p>
        <h1 className="text-2xl font-black">{coop.name}</h1>
        <p className="mt-1 text-sm text-muted">
          Invite the signers, set the rules, then deploy. Budget lines are proposed on chain after the treasury exists,
          because only signers can propose them.
        </p>
      </header>
      {message ? <Banner tone="warn">{message}</Banner> : null}
      {deployed ? (
        <Notice tone="ok">
          This co-op is already on chain. <Link href={`/c/${id}/settings`}>Open settings</Link>.
        </Notice>
      ) : null}

      <Card title="Signers" description="President, treasurer, secretary and reviewer. Each one creates a passkey." hue="blue">
        {signers.length === 0 ? (
          <p className="text-sm text-muted">No signers yet.</p>
        ) : (
          <ul className="mb-4 space-y-2">
            {signers.map((s) => (
              <li key={s.person.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span>
                  <span className="font-extrabold">{s.person.name}</span>
                  <span className="text-muted">
                    {" "}
                    · {s.roles.filter((r) => r in ROLE_LABEL).map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL]).join(", ")}
                  </span>
                </span>
                <span className={s.person.safeAddress ? "font-extrabold text-blue-ink" : "text-muted"}>
                  {s.person.safeAddress ? "Passkey ready" : "No passkey yet"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <form action={invite.bind(null, id)} className="space-y-3">
          <label className={label}>
            Name
            <input className={field} name="name" required maxLength={80} />
          </label>
          <label className={label}>
            Phone
            <input className={field} name="phone" required placeholder="+5491112345678" />
          </label>
          <label className={label}>
            Role
            <select className={field} name="role" defaultValue="tesorero">
              {SIGNER_ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Invite
          </Button>
        </form>
        <div className="mt-4">
          <LinkButton
            label="Create passkey links"
            empty="Every invited signer already has a passkey, or there are no signers yet."
            load={enrollLinks.bind(null, id)}
          />
          <p className={hint}>Send each link to that person. They open it on their phone and create the signature.</p>
        </div>
      </Card>

      <Card title="Rules" description="Caps are set when the treasury is deployed. Lines are proposed afterwards." hue="yellow">
        <form action={saveSetup.bind(null, id)} className="space-y-3">
          <label className={label}>
            Signatures required
            <input className={field} name="threshold" type="number" min={1} max={20} defaultValue={draft.threshold} required />
            <span className={hint}>Cannot be higher than the number of signers.</span>
          </label>
          <label className={label}>
            Cap per payment (pesos)
            <input className={field} name="perTx" inputMode="numeric" defaultValue={wholePesos(draft.perTxCap)} required />
          </label>
          <label className={label}>
            Monthly cap per vendor (pesos)
            <input className={field} name="monthly" inputMode="numeric" defaultValue={wholePesos(draft.vendorMonthlyCap)} required />
          </label>
          <fieldset className="space-y-3">
            <legend className={label}>Budget lines</legend>
            {Array.from({ length: rows }, (_, i) => {
              const line = draft.lines[i];
              return (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <label className={`${label} col-span-2`}>
                    Name
                    <input className={field} name="lineName" defaultValue={line?.name ?? ""} maxLength={60} />
                  </label>
                  <label className={label}>
                    Amount
                    <input className={field} name="lineAmount" inputMode="decimal" defaultValue={line ? wholePesos(line.allocated) : ""} />
                  </label>
                  <label className={label}>
                    Ends
                    <input className={field} name="lineEnd" type="date" defaultValue={line ? dateInput(line.periodEnd) : ""} />
                  </label>
                </div>
              );
            })}
            <span className={hint}>Whole pesos. An empty row is skipped. Save again to add another line.</span>
          </fieldset>
          <Button type="submit" variant="secondary">
            Save rules
          </Button>
        </form>
        {draft.lines.length > 0 ? (
          <p className="mt-3 text-sm text-muted">
            Saved: {draft.lines.map((l) => `${l.name} (${formatPesos(l.allocated)})`).join(", ")}.
          </p>
        ) : null}
      </Card>

      {deployed ? null : (
        <Card title="Deploy" description="One transaction creates this co-op’s treasury and deposit-box factory." hue="red">
          <form action={deploy.bind(null, id)}>
            <Button type="submit">Deploy on Celo</Button>
          </form>
        </Card>
      )}
    </main>
  );
}

import { Suspense } from "react";
import { getDb } from "@/db";
import { env } from "@/lib/env";
import { shortAddress } from "@/lib/wallet/format";
import { firstParam, pageSession } from "@/lib/wallet/session";
import { EnrollPasskey } from "../_components/enroll";
import { Card, Loading, PageTitle, Problem } from "../_components/ui";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function AltaPage({ searchParams }: Props) {
  return (
    <Suspense fallback={<Loading />}>
      <Alta searchParams={searchParams} />
    </Suspense>
  );
}

async function Alta({ searchParams }: Props) {
  const token = firstParam((await searchParams).t);
  let session;
  try {
    session = await pageSession(getDb(), token, ["enroll"]);
  } catch (error) {
    console.error(error);
    return <Problem message="We couldn't load the page. Try again in a bit." />;
  }
  if (!session.ok) return <Problem message={session.message} />;
  const { link, safe } = session;

  if (safe) {
    return (
      <div className="space-y-4">
        <PageTitle eyebrow={`Hi, ${link.person.name}`}>Your signature is already set up</PageTitle>
        <Card>
          <p className="text-[15px] text-muted">
            Your account number in the co-op is <span className="font-mono font-semibold text-ink">{shortAddress(safe)}</span>. Nothing else to do.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageTitle eyebrow={`Hi, ${link.person.name}`}>Create your signature for the co-op</PageTitle>
      <p className="text-[15px] leading-relaxed text-muted">
        You’ll create a signature with this phone’s fingerprint, face or PIN. You’ll use it to approve the co-op’s big
        payments, with no passwords and nothing to pay.
      </p>
      <EnrollPasskey token={token!} name={link.person.name} rpId={env().RP_ID} />
    </div>
  );
}

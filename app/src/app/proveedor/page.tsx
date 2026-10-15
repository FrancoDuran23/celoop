import { Suspense } from "react";
import { getDb } from "@/db";
import { warsAddress } from "@/lib/chain/treasury";
import { env } from "@/lib/env";
import { chainReader, pageChainConfig } from "@/lib/wallet/server";
import { firstParam, pageSession } from "@/lib/wallet/session";
import { loadVendorView } from "@/lib/wallet/views";
import { Loading, PageTitle, Problem } from "../firmar/_components/ui";
import { VendorEnroll, VendorPanel } from "./vendor-panel";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default function VendorPage(props: Props) {
  return (
    <Suspense fallback={<Loading label="Finding your payments…" />}>
      <Vendor {...props} />
    </Suspense>
  );
}

type Loaded =
  | { ok: true; enroll: { token: string; name: string; rpId: string } }
  | { ok: true; panel: Parameters<typeof VendorPanel>[0] }
  | { ok: false; message: string };

async function load(token: string | null): Promise<Loaded> {
  try {
    const db = getDb();
    const session = await pageSession(db, token, ["vendor"]);
    if (!session.ok) return session;
    const { link, credential, safe } = session;
    if (!credential || !safe) return { ok: true, enroll: { token: token!, name: link.person.name, rpId: env().RP_ID } };
    const view = await loadVendorView(db, chainReader, link.person.id, safe);
    if (!view) return { ok: false, message: "We couldn't find your vendor details. Let the co-op's board know." };
    const [config, wars] = await Promise.all([pageChainConfig(), warsAddress()]);
    return { ok: true, panel: { view, wars, name: link.person.name, signer: { token: token!, credential, safe, ...config } } };
  } catch (error) {
    console.error(error);
    return { ok: false, message: "We couldn't load your payments. Try again in a bit." };
  }
}

async function Vendor({ searchParams }: Props) {
  const loaded = await load(firstParam((await searchParams).t));
  if (!loaded.ok) return <Problem message={loaded.message} />;
  if ("panel" in loaded) return <VendorPanel {...loaded.panel} />;
  return (
    <div className="space-y-5">
      <PageTitle eyebrow={`Hi, ${loaded.enroll.name}`}>Create your signature to get paid</PageTitle>
      <p className="text-[15px] leading-relaxed text-muted">
        To see and withdraw your payments you’ll create a signature with this phone’s fingerprint, face or PIN. It’s free.
      </p>
      <VendorEnroll {...loaded.enroll} />
    </div>
  );
}

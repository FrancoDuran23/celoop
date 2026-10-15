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
    <Suspense fallback={<Loading label="Buscando tus cobros…" />}>
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
    if (!view) return { ok: false, message: "No encontramos tus datos de proveedor. Avisale a la comisión de la cooperadora." };
    const [config, wars] = await Promise.all([pageChainConfig(), warsAddress()]);
    return { ok: true, panel: { view, wars, name: link.person.name, signer: { token: token!, credential, safe, ...config } } };
  } catch (error) {
    console.error(error);
    return { ok: false, message: "No pudimos cargar tus cobros. Probá de nuevo en un rato." };
  }
}

async function Vendor({ searchParams }: Props) {
  const loaded = await load(firstParam((await searchParams).t));
  if (!loaded.ok) return <Problem message={loaded.message} />;
  if ("panel" in loaded) return <VendorPanel {...loaded.panel} />;
  return (
    <div className="space-y-5">
      <PageTitle eyebrow={`Hola, ${loaded.enroll.name}`}>Creá tu firma para cobrar</PageTitle>
      <p className="text-[15px] leading-relaxed text-black/75 dark:text-white/75">
        Para ver y retirar tus cobros vas a crear una firma con la huella, la cara o el PIN de este teléfono. No tiene costo.
      </p>
      <VendorEnroll {...loaded.enroll} />
    </div>
  );
}

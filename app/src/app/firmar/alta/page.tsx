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
    return <Problem message="No pudimos cargar la página. Probá de nuevo en un rato." />;
  }
  if (!session.ok) return <Problem message={session.message} />;
  const { link, safe } = session;

  if (safe) {
    return (
      <div className="space-y-4">
        <PageTitle eyebrow={`Hola, ${link.person.name}`}>Ya tenés tu firma creada</PageTitle>
        <Card>
          <p className="text-[15px] text-black/70 dark:text-white/70">
            Tu número de cuenta en la cooperadora es <span className="font-mono font-medium">{shortAddress(safe)}</span>. No hace falta
            hacer nada más.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageTitle eyebrow={`Hola, ${link.person.name}`}>Creá tu firma para la cooperadora</PageTitle>
      <p className="text-[15px] leading-relaxed text-black/75 dark:text-white/75">
        Vas a crear una firma con la huella, la cara o el PIN de este teléfono. Con ella vas a aprobar los pagos grandes de la
        cooperadora, sin contraseñas y sin pagar nada.
      </p>
      <EnrollPasskey token={token!} name={link.person.name} rpId={env().RP_ID} />
    </div>
  );
}

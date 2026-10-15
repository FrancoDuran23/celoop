import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/db";
import { Banner, Card, Money, TxLink } from "@/components";
import { loadAuditView } from "@/lib/auditor/view";
import { formatDate } from "@/lib/report/format";

type Props = { params: Promise<{ paymentId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { paymentId } = await params;
  return { title: `Informe del auditor · pago ${paymentId}` };
}

async function Audit({ params }: Props) {
  const { paymentId } = await params;
  if (!/^\d{1,20}$/.test(paymentId)) notFound();
  const v = await loadAuditView(getDb(), BigInt(paymentId));
  if (!v) notFound();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">
      <header>
        <p className="text-sm text-muted">Informe del auditor</p>
        <h1 className="text-2xl font-semibold">Pago #{v.paymentId}</h1>
        <p className="mt-1 text-muted">
          El auditor es un segundo agente, con su propia llave. Revisa cada pago antes de que pueda salir sin firmas:
          si encuentra algo raro, lo frena y lo tienen que decidir las personas que firman.
        </p>
      </header>

      {v.verdict === "flagged" ? (
        <Banner tone="warn">Observado: el pago no salió automático y quedó para que lo decidan los firmantes.</Banner>
      ) : (
        <Banner tone="ok">Revisado sin observaciones.</Banner>
      )}

      <Card title="El pago">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium">{v.vendor}</span>
          <Money value={v.amount} className="font-semibold" />
        </div>
        <p className="text-sm text-muted">
          {v.invoice ?? "Comprobante que no está en el sistema"}
          {v.cuit ? ` · CUIT ${v.cuit}` : ""}
        </p>
        <p className="mt-1 text-sm text-muted">Revisado el {formatDate(v.checkedAt)}</p>
      </Card>

      <Card title="Observaciones" description="Cada una alcanza para que el pago necesite firmas.">
        {v.observations.length === 0 ? (
          <p className="text-muted">Ninguna.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5">
            {v.observations.map((f) => <li key={f.code}>{f.text}</li>)}
          </ul>
        )}
      </Card>

      {v.notes.length > 0 ? (
        <Card title="Notas" description="Información para quien lea el informe. No frenan el pago.">
          <ul className="list-disc space-y-1 pl-5">
            {v.notes.map((f) => <li key={f.code}>{f.text}</li>)}
          </ul>
        </Card>
      ) : null}

      <Card title="Cómo verificarlo">
        <p className="text-sm">
          El auditor guardó este informe en la cadena con su huella (keccak256). Si descargás{" "}
          <a href={`/auditoria/${v.paymentId}/json`}>el informe en JSON</a> y calculás su huella, tiene que dar:
        </p>
        <p className="num mt-2 break-all text-sm">{v.reportHash}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {v.onchain ? (
            v.hashMatches ? (
              <span className="text-ok">Coincide con la que está en la cadena.</span>
            ) : (
              <span className="text-danger">No coincide con la que está en la cadena.</span>
            )
          ) : (
            <span className="text-muted">Todavía no aparece en la cadena.</span>
          )}
          <TxLink txHash={v.onchain?.txHash} chainId={v.chainId} label="Ver la transacción del auditor" />
        </div>
      </Card>

      <p className="text-sm"><Link href="/">Volver al panel</Link></p>
    </main>
  );
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<p className="mx-auto max-w-3xl px-4 py-10 text-muted">Cargando el informe...</p>}>
      <Audit {...props} />
    </Suspense>
  );
}

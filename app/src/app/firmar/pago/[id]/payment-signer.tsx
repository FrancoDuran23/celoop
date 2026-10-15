"use client";
import { useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { formatCuit, formatPesos } from "@/lib/wallet/format";
import type { PaymentView } from "@/lib/wallet/views";
import { ActionStatus } from "../../_components/action-status";
import { Button, Card, Notice, PageTitle, Row, SignatureCount } from "../../_components/ui";
import { useSafeAction, type SignerConfig } from "../../_components/use-safe-action";

type Choice = "approve" | "reject" | "executePayment";

const DONE: Record<Choice, string> = {
  approve: "Listo. Aprobaste el pago.",
  reject: "Listo. Rechazaste el pago y no se va a hacer.",
  executePayment: "Listo. El pago se hizo.",
};

export function PaymentSigner({ view, treasury, signer, name }: { view: PaymentView; treasury: Address; signer: SignerConfig; name: string }) {
  const { state, run } = useSafeAction(signer);
  const [confirmReject, setConfirmReject] = useState(false);
  const [last, setLast] = useState<Choice>("approve");
  const busy = state.status === "working";
  const done = state.status === "done";
  const pending = view.status === "pending";
  const ready = view.approvals >= view.threshold;

  const act = (choice: Choice) => {
    setLast(choice);
    setConfirmReject(false);
    void run([{ to: treasury, data: encodeFunctionData({ abi: treasuryPolicyAbi, functionName: choice, args: [BigInt(view.paymentId)] }) }]);
  };

  return (
    <div className="space-y-4">
      <PageTitle eyebrow={`Hola, ${name}`}>Pago a {view.vendorName}</PageTitle>

      <Card>
        <p className="text-sm text-black/60 dark:text-white/60">Monto</p>
        <p className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight">{formatPesos(view.amount)}</p>
        <dl className="mt-3">
          <Row label="Proveedor">{view.vendorName}</Row>
          {view.cuit ? <Row label="CUIT">{formatCuit(view.cuit)}</Row> : null}
          <Row label="Partida">{view.lineName}</Row>
          <Row label="Firmas">
            <SignatureCount approvals={view.approvals} threshold={view.threshold} />
          </Row>
        </dl>
        {view.invoiceUrl ? (
          <a
            href={view.invoiceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-11 items-center font-medium text-emerald-800 underline underline-offset-4 dark:text-emerald-300"
          >
            Ver la factura{view.invoiceLabel ? ` (${view.invoiceLabel})` : ""}
          </a>
        ) : null}
      </Card>

      {view.audit?.verdict === "flagged" ? (
        <Notice tone="warn">
          El auditor observó este pago y no lo dejó salir automático:
          <ul className="mt-1 list-disc pl-5">
            {view.audit.observations.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          <a href={view.audit.reportUrl} className="mt-1 inline-block underline underline-offset-4">
            Ver el informe del auditor
          </a>
        </Notice>
      ) : view.audit ? (
        <Notice tone="info">El auditor revisó este pago y no encontró problemas.</Notice>
      ) : null}
      {view.overBudget ? (
        <Notice tone="warn">
          Este pago supera lo que queda en la partida {view.lineName} ({formatPesos(view.lineAvailable)} disponibles). Si lo aprueban, el
          exceso queda marcado en el panel.
        </Notice>
      ) : null}
      {view.paused ? <Notice tone="warn">Los pagos están pausados. Podés firmar, pero no se va a pagar hasta que se reanuden.</Notice> : null}

      {!pending ? (
        <Notice tone={view.status === "executed" ? "ok" : "info"}>
          {view.status === "executed" ? "Este pago ya se hizo. No hace falta que firmes." : "Este pago fue rechazado."}
        </Notice>
      ) : done ? null : view.alreadyApproved ? (
        <div className="space-y-3">
          <Notice tone="ok">Ya firmaste este pago.</Notice>
          {ready && !view.paused ? (
            <Button onClick={() => act("executePayment")} disabled={busy}>
              Hacer el pago ahora
            </Button>
          ) : null}
        </div>
      ) : confirmReject ? (
        <Card className="space-y-3">
          <p className="font-semibold">¿Rechazar este pago?</p>
          <p className="text-[15px] text-black/70 dark:text-white/70">El pago se cancela y el proveedor no cobra por esta factura.</p>
          <Button variant="danger" onClick={() => act("reject")} disabled={busy}>
            Sí, rechazar
          </Button>
          <Button variant="secondary" onClick={() => setConfirmReject(false)} disabled={busy}>
            Volver
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          <Button onClick={() => act("approve")} disabled={busy}>
            {busy && last === "approve" ? "Firmando…" : "Aprobar"}
          </Button>
          <Button variant="secondary" onClick={() => setConfirmReject(true)} disabled={busy}>
            Rechazar
          </Button>
        </div>
      )}

      <ActionStatus state={state} doneText={DONE[last]} />
    </div>
  );
}

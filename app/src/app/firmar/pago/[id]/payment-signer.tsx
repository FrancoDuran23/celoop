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
  approve: "Done. You approved the payment.",
  reject: "Done. You rejected the payment and it won't go through.",
  executePayment: "Done. The payment went through.",
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
      <PageTitle eyebrow={`Hi, ${name}`}>Payment to {view.vendorName}</PageTitle>

      <Card>
        <p className="text-sm font-bold text-muted">Amount</p>
        <p className="mt-0.5 text-3xl font-black tabular-nums tracking-tight">{formatPesos(view.amount)}</p>
        <dl className="mt-3">
          <Row label="Vendor">{view.vendorName}</Row>
          {view.cuit ? <Row label="Tax ID (CUIT)">{formatCuit(view.cuit)}</Row> : null}
          <Row label="Budget line">{view.lineName}</Row>
          <Row label="Signatures">
            <SignatureCount approvals={view.approvals} threshold={view.threshold} />
          </Row>
        </dl>
        {view.invoiceUrl ? (
          <a href={view.invoiceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center font-bold">
            View the invoice{view.invoiceLabel ? ` (${view.invoiceLabel})` : ""}
          </a>
        ) : null}
      </Card>

      {view.audit?.verdict === "flagged" ? (
        <Notice tone="warn">
          The auditor flagged this payment and didn’t let it go out automatically:
          <ul className="mt-1 list-disc pl-5">
            {view.audit.observations.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          <a href={view.audit.reportUrl} className="mt-1 inline-block underline underline-offset-4">
            View the auditor’s report
          </a>
        </Notice>
      ) : view.audit ? (
        <Notice tone="info">The auditor reviewed this payment and found no problems.</Notice>
      ) : null}
      {view.overBudget ? (
        <Notice tone="warn">
          This payment is more than what’s left in the {view.lineName} line ({formatPesos(view.lineAvailable)} available). If it’s
          approved, the excess is flagged on the public ledger.
        </Notice>
      ) : null}
      {view.paused ? <Notice tone="warn">Payments are paused. You can sign, but nothing is paid until they resume.</Notice> : null}

      {!pending ? (
        <Notice tone={view.status === "executed" ? "ok" : "info"}>
          {view.status === "executed" ? "This payment already went through. No need to sign." : "This payment was rejected."}
        </Notice>
      ) : done ? null : view.alreadyApproved ? (
        <div className="space-y-3">
          <Notice tone="ok">You already signed this payment.</Notice>
          {ready && !view.paused ? (
            <Button onClick={() => act("executePayment")} disabled={busy}>
              Pay now
            </Button>
          ) : null}
        </div>
      ) : confirmReject ? (
        <Card className="space-y-3">
          <p className="font-extrabold">Reject this payment?</p>
          <p className="text-[15px] text-muted">The payment is cancelled and the vendor is not paid for this invoice.</p>
          <Button variant="danger" onClick={() => act("reject")} disabled={busy}>
            Yes, reject
          </Button>
          <Button variant="secondary" onClick={() => setConfirmReject(false)} disabled={busy}>
            Back
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          <Button onClick={() => act("approve")} disabled={busy}>
            {busy && last === "approve" ? "Signing…" : "Approve"}
          </Button>
          <Button variant="secondary" onClick={() => setConfirmReject(true)} disabled={busy}>
            Reject
          </Button>
        </div>
      )}

      <ActionStatus state={state} doneText={DONE[last]} />
    </div>
  );
}

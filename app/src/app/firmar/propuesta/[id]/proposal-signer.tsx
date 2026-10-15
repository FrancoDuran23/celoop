"use client";
import { encodeFunctionData, type Address } from "viem";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import type { ProposalView } from "@/lib/wallet/views";
import { ActionStatus } from "../../_components/action-status";
import { PauseButton } from "../../_components/pause-button";
import { Button, Card, Notice, PageTitle, Row, SignatureCount } from "../../_components/ui";
import { useSafeAction, type SignerConfig } from "../../_components/use-safe-action";
import { syncProposal } from "./actions";

export function ProposalSigner({ view, treasury, signer, name }: { view: ProposalView; treasury: Address; signer: SignerConfig; name: string }) {
  const { state, run } = useSafeAction(signer);
  const busy = state.status === "working";
  const open = view.status === "open";

  const approve = async () => {
    const result = await run([
      { to: treasury, data: encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "approveProposal", args: [BigInt(view.proposalId)] }) },
    ]);
    if (result) await syncProposal({ token: signer.token, proposalId: view.proposalId });
  };

  return (
    <div className="space-y-4">
      <PageTitle eyebrow={`Hola, ${name}`}>Cambio propuesto</PageTitle>

      <Card>
        <p className="text-lg leading-snug font-medium text-pretty">{view.summary}</p>
        <dl className="mt-3">
          <Row label="Firmas">
            <SignatureCount approvals={view.approvals} threshold={view.threshold} />
          </Row>
        </dl>
      </Card>

      {view.reasonMatches === false ? (
        <Notice tone="warn">Ojo: el motivo guardado no coincide con el que quedó registrado en la propuesta. Consultá antes de firmar.</Notice>
      ) : null}
      {view.paused && view.kind !== "Unpause" ? <Notice tone="warn">Los pagos están pausados en este momento.</Notice> : null}

      {!open ? (
        <Notice tone="ok">Esta propuesta ya se aplicó. No hace falta que firmes.</Notice>
      ) : state.status === "done" ? null : view.alreadyApproved ? (
        <Notice tone="ok">Ya firmaste esta propuesta.</Notice>
      ) : (
        <Button onClick={() => void approve()} disabled={busy}>
          {busy ? "Firmando…" : "Aprobar"}
        </Button>
      )}
      <ActionStatus state={state} doneText="Listo. Aprobaste la propuesta." />

      {!view.paused && state.status !== "working" ? (
        <div className="pt-4">
          <PauseButton treasury={treasury} signer={signer} disabled={state.status === "done"} />
        </div>
      ) : null}
    </div>
  );
}

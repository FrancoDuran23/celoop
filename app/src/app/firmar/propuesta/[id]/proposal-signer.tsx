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
      <PageTitle eyebrow={`Hi, ${name}`}>Proposed change</PageTitle>

      <Card>
        <p className="text-lg leading-snug font-bold text-pretty">{view.summary}</p>
        <dl className="mt-3">
          <Row label="Signatures">
            <SignatureCount approvals={view.approvals} threshold={view.threshold} />
          </Row>
        </dl>
      </Card>

      {view.reasonMatches === false ? (
        <Notice tone="warn">Heads up: the saved reason doesn’t match what was recorded in the proposal. Ask before signing.</Notice>
      ) : null}
      {view.paused && view.kind !== "Unpause" ? <Notice tone="warn">Payments are paused right now.</Notice> : null}

      {!open ? (
        <Notice tone="ok">This proposal was already applied. No need to sign.</Notice>
      ) : state.status === "done" ? null : view.alreadyApproved ? (
        <Notice tone="ok">You already signed this proposal.</Notice>
      ) : (
        <Button onClick={() => void approve()} disabled={busy}>
          {busy ? "Signing…" : "Approve"}
        </Button>
      )}
      <ActionStatus state={state} doneText="Done. You approved the proposal." />

      {!view.paused && state.status !== "working" ? (
        <div className="pt-4">
          <PauseButton treasury={treasury} signer={signer} disabled={state.status === "done"} />
        </div>
      ) : null}
    </div>
  );
}

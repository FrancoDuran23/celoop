"use client";
// Any signer can pause every payment, with or without a proposal.
import { useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { ActionStatus } from "./action-status";
import { Button, Card } from "./ui";
import { useSafeAction, type SignerConfig } from "./use-safe-action";

export function PauseButton({ treasury, signer, disabled }: { treasury: Address; signer: SignerConfig; disabled?: boolean }) {
  const { state, run } = useSafeAction(signer);
  const [confirming, setConfirming] = useState(false);
  if (state.status === "done") return <ActionStatus state={state} doneText="Done. Payments are paused." />;
  return (
    <div className="space-y-3">
      {confirming ? (
        <Card className="space-y-3">
          <p className="font-extrabold">Pause all payments?</p>
          <p className="text-[15px] text-muted">
            Automatic and signed payments stop until the board approves resuming them. Use it if something looks wrong.
          </p>
          <Button
            variant="danger"
            disabled={disabled || state.status === "working"}
            onClick={() => void run([{ to: treasury, data: encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "pause" }) }])}
          >
            {state.status === "working" ? "Pausing…" : "Yes, pause payments"}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={state.status === "working"}>
            Back
          </Button>
        </Card>
      ) : (
        <Button variant="danger" onClick={() => setConfirming(true)} disabled={disabled}>
          Pause all payments
        </Button>
      )}
      <ActionStatus state={state} doneText="" />
    </div>
  );
}

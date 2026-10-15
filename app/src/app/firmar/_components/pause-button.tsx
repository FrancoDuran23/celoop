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
  if (state.status === "done") return <ActionStatus state={state} doneText="Listo. Los pagos quedaron pausados." />;
  return (
    <div className="space-y-3">
      {confirming ? (
        <Card className="space-y-3">
          <p className="font-semibold">¿Pausar todos los pagos?</p>
          <p className="text-[15px] text-black/70 dark:text-white/70">
            Se frenan los pagos automáticos y los firmados hasta que la comisión apruebe reanudarlos. Usalo si algo no está bien.
          </p>
          <Button
            variant="danger"
            disabled={disabled || state.status === "working"}
            onClick={() => void run([{ to: treasury, data: encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "pause" }) }])}
          >
            {state.status === "working" ? "Pausando…" : "Sí, pausar los pagos"}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={state.status === "working"}>
            Volver
          </Button>
        </Card>
      ) : (
        <Button variant="danger" onClick={() => setConfirming(true)} disabled={disabled}>
          Pausar todos los pagos
        </Button>
      )}
      <ActionStatus state={state} doneText="" />
    </div>
  );
}

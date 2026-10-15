"use client";
import type { ActionState } from "./use-safe-action";
import { Notice } from "./ui";

/** Feedback while signing and the result with the public record link. */
export function ActionStatus({ state, doneText }: { state: ActionState; doneText: string }) {
  if (state.status === "working") {
    return <Notice>Confirm with your fingerprint, face or PIN. It then takes a few seconds to be recorded.</Notice>;
  }
  if (state.status === "error") return <Notice tone="error">{state.message}</Notice>;
  if (state.status === "done") {
    return (
      <Notice tone="ok">
        <p className="font-bold">{doneText}</p>
        {state.explorerUrl ? (
          <a className="mt-1 inline-block" href={state.explorerUrl} target="_blank" rel="noreferrer">
            View the operation on the public ledger
          </a>
        ) : null}
      </Notice>
    );
  }
  return null;
}

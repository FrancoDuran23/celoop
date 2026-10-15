"use client";
import type { ActionState } from "./use-safe-action";
import { Notice } from "./ui";

/** Feedback while signing and the result with the public record link. */
export function ActionStatus({ state, doneText }: { state: ActionState; doneText: string }) {
  if (state.status === "working") {
    return <Notice>Confirmá con tu huella, tu cara o tu PIN. Después tarda unos segundos en quedar registrado.</Notice>;
  }
  if (state.status === "error") return <Notice tone="error">{state.message}</Notice>;
  if (state.status === "done") {
    return (
      <Notice tone="ok">
        <p className="font-semibold">{doneText}</p>
        {state.explorerUrl ? (
          <a className="mt-1 inline-block underline underline-offset-4" href={state.explorerUrl} target="_blank" rel="noreferrer">
            Ver la operación en el registro público
          </a>
        ) : null}
      </Notice>
    );
  }
  return null;
}

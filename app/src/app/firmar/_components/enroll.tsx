"use client";
// Creates the passkey in this phone and registers the Safe it owns.
import { useState } from "react";
import { createWebAuthnCredential } from "viem/account-abstraction";
import { shortAddress } from "@/lib/wallet/format";
import { Button, Card, Notice } from "./ui";

type State = { status: "idle" } | { status: "working" } | { status: "done"; safe: string } | { status: "error"; message: string };

export function EnrollPasskey({ token, name, rpId, onDone }: { token: string; name: string; rpId: string; onDone?: () => void }) {
  const [state, setState] = useState<State>({ status: "idle" });

  const create = async () => {
    setState({ status: "working" });
    let credential;
    try {
      credential = await createWebAuthnCredential({
        name: `${name} · Cooperadora`,
        rp: { id: rpId, name: "Cooperadora Abierta" },
      });
    } catch (error) {
      console.error(error);
      setState({ status: "error", message: "No se pudo crear la firma. Probá de nuevo y confirmá con tu huella, tu cara o tu PIN." });
      return;
    }
    try {
      const res = await fetch("/api/passkeys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, credentialId: credential.id, publicKey: credential.publicKey }),
      });
      const body = (await res.json()) as { safeAddress?: string; message?: string };
      if (!res.ok || !body.safeAddress) {
        setState({ status: "error", message: body.message ?? "No pudimos guardar tu firma. Probá de nuevo en un rato." });
        return;
      }
      setState({ status: "done", safe: body.safeAddress });
      onDone?.();
    } catch {
      setState({ status: "error", message: "No hay conexión. Revisá internet y probá de nuevo." });
    }
  };

  if (state.status === "done") {
    return (
      <Card className="space-y-2">
        <p className="text-lg font-semibold">Listo. Tu firma quedó creada.</p>
        <p className="text-[15px] text-black/70 dark:text-white/70">
          Tu número de cuenta en la cooperadora es <span className="font-mono font-medium">{shortAddress(state.safe)}</span>.
          La comisión te va a sumar como firmante y te vamos a avisar por el chat.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Button onClick={create} disabled={state.status === "working"}>
        {state.status === "working" ? "Esperando tu huella…" : "Crear mi firma"}
      </Button>
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
    </div>
  );
}

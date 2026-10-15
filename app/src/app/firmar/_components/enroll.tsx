"use client";
// Creates the passkey in this phone and registers the Safe it owns.
import { useState } from "react";
import { createWebAuthnCredential } from "viem/account-abstraction";
import { shortAddress } from "@/lib/wallet/format";
import { Button, Card, Notice } from "./ui";
import { APP_NAME } from "@/lib/brand";

type State = { status: "idle" } | { status: "working" } | { status: "done"; safe: string } | { status: "error"; message: string };

export function EnrollPasskey({ token, name, rpId, onDone }: { token: string; name: string; rpId: string; onDone?: () => void }) {
  const [state, setState] = useState<State>({ status: "idle" });

  const create = async () => {
    setState({ status: "working" });
    let credential;
    try {
      credential = await createWebAuthnCredential({
        name: `${name} · ${APP_NAME}`,
        rp: { id: rpId, name: APP_NAME },
      });
    } catch (error) {
      console.error(error);
      setState({ status: "error", message: "We couldn't create your signature. Try again and confirm with your fingerprint, face or PIN." });
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
        setState({ status: "error", message: body.message ?? "We couldn't save your signature. Try again in a bit." });
        return;
      }
      setState({ status: "done", safe: body.safeAddress });
      onDone?.();
    } catch {
      setState({ status: "error", message: "No connection. Check your internet and try again." });
    }
  };

  if (state.status === "done") {
    return (
      <Card className="space-y-2">
        <p className="text-lg font-extrabold">Done. Your signature is ready.</p>
        <p className="text-[15px] text-muted">
          Your account number in the co-op is <span className="font-mono font-semibold text-ink">{shortAddress(state.safe)}</span>.
          The board will add you as a signer and we’ll let you know in the chat.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Button onClick={create} disabled={state.status === "working"}>
        {state.status === "working" ? "Waiting for your fingerprint…" : "Create my signature"}
      </Button>
      {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { encodeFunctionData, erc20Abi, getAddress, isAddress, type Address } from "viem";
import { formatPesos, parsePesos, shortAddress } from "@/lib/wallet/format";
import { ripioOfframpUrl } from "@/lib/wallet/ripio";
import type { VendorView } from "@/lib/wallet/views";
import { ActionStatus } from "../firmar/_components/action-status";
import { EnrollPasskey } from "../firmar/_components/enroll";
import { Button, Card, Notice, PageTitle, field } from "../firmar/_components/ui";
import { useSafeAction, type SignerConfig } from "../firmar/_components/use-safe-action";

export function VendorEnroll(props: { token: string; name: string; rpId: string }) {
  const router = useRouter();
  return <EnrollPasskey {...props} onDone={() => setTimeout(() => router.refresh(), 1500)} />;
}

const STATUS: Record<string, string> = { executed: "Paid", pending: "Waiting for signatures", rejected: "Rejected" };

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires" });

export function VendorPanel({ view, wars, name, signer }: { view: VendorView; wars: Address; name: string; signer: SignerConfig }) {
  const { state, run } = useSafeAction(signer);
  const balance = BigInt(view.balance);
  const [step, setStep] = useState<"start" | "address" | "confirm">("start");
  const [destination, setDestination] = useState("");
  const [amountText, setAmountText] = useState("");
  const amount = amountText ? parsePesos(amountText) : balance;
  const validAddress = isAddress(destination.trim(), { strict: false });
  const amountOk = amount !== null && amount > BigInt(0) && amount <= balance;

  const openRipio = () => {
    window.open(ripioOfframpUrl({ amount: balance, address: view.address }), "_blank", "noopener");
    if (view.canTransfer) setStep("address");
  };

  const send = () => {
    const to = getAddress(destination.trim());
    void run([{ to: wars, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount!] }) }]);
  };

  return (
    <div className="space-y-5">
      <PageTitle eyebrow={`Hi, ${name}`}>{view.legalName}</PageTitle>

      <Card className="bg-yellow">
        <p className="text-sm font-bold">Available to withdraw</p>
        <p className="mt-0.5 text-3xl font-black tabular-nums tracking-tight">{formatPesos(balance)}</p>
      </Card>

      {state.status === "done" ? (
        <ActionStatus state={state} doneText={`Done. You sent ${formatPesos(amount ?? BigInt(0))} to Ripio. It reaches your bank account in a few minutes.`} />
      ) : balance === BigInt(0) ? (
        <Notice>When the co-op pays you, the money shows up here.</Notice>
      ) : step === "start" ? (
        <div className="space-y-2">
          <Button onClick={openRipio}>Move to my bank account</Button>
          <p className="text-center text-sm text-muted">Ripio opens so you can pick your account.</p>
          {!view.canTransfer ? (
            <Notice tone="info">Your payments go to another account, not this phone’s signature. Withdraw them from there.</Notice>
          ) : null}
        </div>
      ) : step === "address" ? (
        <Card className="space-y-4">
          <p className="text-[15px] leading-relaxed">
            In Ripio, follow the steps until it shows you a <strong>deposit address</strong>. Copy it and paste it here.
          </p>
          <label className="block text-sm font-bold">
            Address Ripio gave you
            <input
              className={`${field} font-mono text-sm`}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="0x…"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
          </label>
          <label className="block text-sm font-bold">
            Amount in pesos
            <input
              className={field}
              inputMode="decimal"
              placeholder={formatPesos(balance).replace("$ ", "")}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
            <span className="mt-1 block text-sm font-normal text-muted">Leave it empty to send everything.</span>
          </label>
          {destination && !validAddress ? <Notice tone="warn">That address doesn’t look complete. Copy it again from Ripio.</Notice> : null}
          {amountText && !amountOk ? <Notice tone="warn">The amount has to be more than zero and no more than {formatPesos(balance)}.</Notice> : null}
          <Button onClick={() => setStep("confirm")} disabled={!validAddress || !amountOk}>
            Review
          </Button>
          <Button variant="secondary" onClick={openRipio}>
            Open Ripio again
          </Button>
        </Card>
      ) : (
        <Card className="space-y-3">
          <p className="font-extrabold">Send {formatPesos(amount!)} to Ripio?</p>
          <p className="text-[15px] text-muted">
            It goes to <span className="font-mono text-ink">{shortAddress(destination.trim())}</span>. Check it’s the same one Ripio shows
            you: if it’s wrong, the money can’t be recovered.
          </p>
          <Button onClick={send} disabled={state.status === "working"}>
            {state.status === "working" ? "Sending…" : "Confirm with my fingerprint"}
          </Button>
          <Button variant="secondary" onClick={() => setStep("address")} disabled={state.status === "working"}>
            Change something
          </Button>
        </Card>
      )}
      {state.status !== "done" ? <ActionStatus state={state} doneText="" /> : null}

      <section>
        <h2 className="mb-2 text-lg font-extrabold">Your payments</h2>
        {view.payments.length === 0 ? (
          <p className="text-[15px] text-muted">No payments yet.</p>
        ) : (
          <ul className="divide-y-2 divide-line rounded-2xl border-[3px] border-ink bg-surface shadow-hard-sm">
            {view.payments.map((p) => (
              <li key={p.paymentId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-bold">{p.invoiceLabel ?? `Payment ${p.paymentId}`}</p>
                  <p className="text-sm text-muted">
                    {STATUS[p.status] ?? p.status}
                    {p.date ? ` · ${formatDate(p.date)}` : ""}
                  </p>
                </div>
                <p className="shrink-0 font-extrabold tabular-nums">{formatPesos(p.amount)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { encodeFunctionData, erc20Abi, getAddress, isAddress, type Address } from "viem";
import { formatPesos, parsePesos, shortAddress } from "@/lib/wallet/format";
import { ripioOfframpUrl } from "@/lib/wallet/ripio";
import type { VendorView } from "@/lib/wallet/views";
import { ActionStatus } from "../firmar/_components/action-status";
import { EnrollPasskey } from "../firmar/_components/enroll";
import { Button, Card, Notice, PageTitle } from "../firmar/_components/ui";
import { useSafeAction, type SignerConfig } from "../firmar/_components/use-safe-action";

export function VendorEnroll(props: { token: string; name: string; rpId: string }) {
  const router = useRouter();
  return <EnrollPasskey {...props} onDone={() => setTimeout(() => router.refresh(), 1500)} />;
}

const STATUS: Record<string, string> = { executed: "Cobrado", pending: "Esperando firmas", rejected: "Rechazado" };

const field =
  "mt-1 block min-h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-base dark:border-white/20 dark:bg-white/5";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires" });

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
      <PageTitle eyebrow={`Hola, ${name}`}>{view.legalName}</PageTitle>

      <Card>
        <p className="text-sm text-black/60 dark:text-white/60">Tenés para retirar</p>
        <p className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight">{formatPesos(balance)}</p>
      </Card>

      {state.status === "done" ? (
        <ActionStatus state={state} doneText={`Listo. Enviaste ${formatPesos(amount ?? BigInt(0))} a Ripio. En unos minutos te llega a tu cuenta.`} />
      ) : balance === BigInt(0) ? (
        <Notice>Cuando la cooperadora te pague, el dinero va a aparecer acá.</Notice>
      ) : step === "start" ? (
        <div className="space-y-2">
          <Button onClick={openRipio}>Pasar a mi cuenta bancaria</Button>
          <p className="text-center text-sm text-black/60 dark:text-white/60">Se abre Ripio para que elijas tu cuenta.</p>
          {!view.canTransfer ? (
            <Notice tone="info">Tus cobros llegan a otra cuenta, no a la firma de este teléfono. Retiralos desde ahí.</Notice>
          ) : null}
        </div>
      ) : step === "address" ? (
        <Card className="space-y-4">
          <p className="text-[15px] leading-relaxed">
            En Ripio seguí los pasos hasta que te muestre una <strong>dirección para depositar</strong>. Copiala y pegala acá.
          </p>
          <label className="block text-sm font-medium">
            Dirección que te dio Ripio
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
          <label className="block text-sm font-medium">
            Monto en pesos
            <input
              className={field}
              inputMode="decimal"
              placeholder={formatPesos(balance).replace("$ ", "")}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
            <span className="mt-1 block text-sm font-normal text-black/60 dark:text-white/60">Si lo dejás vacío, se envía todo.</span>
          </label>
          {destination && !validAddress ? <Notice tone="warn">Esa dirección no parece completa. Copiala de nuevo desde Ripio.</Notice> : null}
          {amountText && !amountOk ? <Notice tone="warn">El monto tiene que ser mayor a cero y no más de {formatPesos(balance)}.</Notice> : null}
          <Button onClick={() => setStep("confirm")} disabled={!validAddress || !amountOk}>
            Revisar
          </Button>
          <Button variant="secondary" onClick={openRipio}>
            Volver a abrir Ripio
          </Button>
        </Card>
      ) : (
        <Card className="space-y-3">
          <p className="font-semibold">¿Enviar {formatPesos(amount!)} a Ripio?</p>
          <p className="text-[15px] text-black/70 dark:text-white/70">
            Van a la dirección <span className="font-mono">{shortAddress(destination.trim())}</span>. Revisá que sea la misma que te
            muestra Ripio: si está mal, el dinero no se puede recuperar.
          </p>
          <Button onClick={send} disabled={state.status === "working"}>
            {state.status === "working" ? "Enviando…" : "Confirmar con mi huella"}
          </Button>
          <Button variant="secondary" onClick={() => setStep("address")} disabled={state.status === "working"}>
            Cambiar algo
          </Button>
        </Card>
      )}
      {state.status !== "done" ? <ActionStatus state={state} doneText="" /> : null}

      <section>
        <h2 className="mb-2 text-lg font-semibold">Tus cobros</h2>
        {view.payments.length === 0 ? (
          <p className="text-[15px] text-black/60 dark:text-white/60">Todavía no hay cobros.</p>
        ) : (
          <ul className="divide-y divide-black/5 rounded-2xl border border-black/10 dark:divide-white/10 dark:border-white/15">
            {view.payments.map((p) => (
              <li key={p.paymentId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.invoiceLabel ?? `Pago ${p.paymentId}`}</p>
                  <p className="text-sm text-black/60 dark:text-white/60">
                    {STATUS[p.status] ?? p.status}
                    {p.date ? ` · ${formatDate(p.date)}` : ""}
                  </p>
                </div>
                <p className="shrink-0 font-semibold tabular-nums">{formatPesos(p.amount)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

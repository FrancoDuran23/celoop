"use client";
import { useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { formatCuit, formatPesos, shortAddress } from "@/lib/wallet/format";
import { buildProposal, slugify, type BuiltProposal, type ProposalInput } from "@/lib/wallet/proposal-builder";
import type { ProposeContext } from "@/lib/wallet/views";
import { ActionStatus } from "../_components/action-status";
import { PauseButton } from "../_components/pause-button";
import { Button, Card, Notice, PageTitle } from "../_components/ui";
import { useSafeAction, type SignerConfig } from "../_components/use-safe-action";
import { saveProposalMeta } from "./actions";

type Kind = ProposalInput["kind"];

const KINDS: [Kind, string][] = [
  ["MoveBudget", "Mover entre partidas"],
  ["SetBudget", "Cargar o cambiar una partida"],
  ["SetVendor", "Alta o baja de proveedor"],
  ["SetCaps", "Cambiar topes"],
  ["Unpause", "Reanudar pagos"],
];

const field =
  "mt-1 block min-h-12 w-full rounded-xl border border-black/15 bg-white px-3 text-base dark:border-white/20 dark:bg-white/5";
const label = "block text-sm font-medium";
const hint = "mt-1 block text-sm font-normal text-black/60 dark:text-white/60";

export function ProposeForm({ context, treasury, signer, name }: { context: ProposeContext; treasury: Address; signer: SignerConfig; name: string }) {
  const { lines, vendors, vendorPeople, caps, paused } = context;
  const { state, run } = useSafeAction(signer);
  const [kind, setKind] = useState<Kind>(paused ? "Unpause" : "MoveBudget");
  const [review, setReview] = useState<BuiltProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);

  // MoveBudget
  const [from, setFrom] = useState<string>(lines[0]?.lineId ?? "");
  const [to, setTo] = useState<string>(lines[1]?.lineId ?? "");
  const [moveAmount, setMoveAmount] = useState("");
  const [reason, setReason] = useState("");
  // SetBudget
  const [budgetLine, setBudgetLine] = useState<string>(lines[0]?.lineId ?? "new");
  const [newLineName, setNewLineName] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  // SetVendor
  const [legalName, setLegalName] = useState("");
  const [cuit, setCuit] = useState("");
  const [vendorAddress, setVendorAddress] = useState<string>(vendorPeople[0]?.safeAddress ?? "");
  const [enabled, setEnabled] = useState(true);
  // SetCaps
  const [perTxCap, setPerTxCap] = useState("");
  const [monthlyCap, setMonthlyCap] = useState("");

  const input = (): ProposalInput => {
    switch (kind) {
      case "MoveBudget":
        return { kind, fromLine: from, toLine: to, amount: moveAmount, reason };
      case "SetBudget":
        return { kind, line: budgetLine, newName: newLineName, amount: budgetAmount, periodEnd };
      case "SetVendor":
        return { kind, legalName, cuit, address: vendorAddress, enabled };
      case "SetCaps":
        return { kind, perTxCap, vendorMonthlyCap: monthlyCap };
      case "Unpause":
        return { kind };
    }
  };

  const startReview = () => {
    if (kind === "Unpause" && !paused) return setError("Los pagos no están pausados.");
    const built = buildProposal(input(), { lines });
    if (!built.ok) return setError(built.error);
    setError(null);
    setReview(built.proposal);
  };

  const pickVendor = (address: string) => {
    const v = vendors.find((x) => x.address === address);
    if (!v) return;
    setLegalName(v.legalName);
    setCuit(formatCuit(v.cuit));
    setVendorAddress(v.address);
    setEnabled(!v.enabled);
  };

  const submit = async (proposal: BuiltProposal) => {
    const result = await run([
      { to: treasury, data: encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "propose", args: [proposal.kindIndex, proposal.data] }) },
    ]);
    if (!result) return;
    const { reasonText, newLine, vendorLegalName } = proposal.meta;
    if (!reasonText && !newLine && !vendorLegalName) return;
    const saved = await saveProposalMeta({ token: signer.token, txHash: result.transactionHash, reasonText, newLine, vendorLegalName });
    setSaveWarning(saved.ok ? null : saved.message);
  };

  if (state.status === "done" && review) {
    return (
      <div className="space-y-4">
        <PageTitle eyebrow={`Hola, ${name}`}>Propuesta enviada</PageTitle>
        <Card>
          <p className="text-lg leading-snug font-medium text-pretty">{review.summary}</p>
          <p className="mt-2 text-[15px] text-black/70 dark:text-white/70">Tu firma ya cuenta. Les avisamos a los demás firmantes para que la revisen.</p>
        </Card>
        {saveWarning ? <Notice tone="warn">La propuesta quedó registrada, pero {saveWarning.toLowerCase()} Avisale a la comisión.</Notice> : null}
        <ActionStatus state={state} doneText="Listo." />
      </div>
    );
  }

  const editing = !review;

  return (
    <div className="space-y-5">
      <PageTitle eyebrow={`Hola, ${name}`}>Proponer un cambio</PageTitle>

      <fieldset className="grid grid-cols-2 gap-2" disabled={!editing}>
        <legend className="sr-only">Tipo de cambio</legend>
        {KINDS.map(([value, text]) => (
          <label
            key={value}
            className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border px-3 py-2 text-center text-[15px] leading-tight font-medium last:col-span-2 ${
              kind === value ? "border-emerald-700 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100" : "border-black/15 dark:border-white/20"
            }`}
          >
            <input
              type="radio"
              name="kind"
              value={value}
              checked={kind === value}
              onChange={() => {
                setKind(value);
                setError(null);
              }}
              className="sr-only"
            />
            {text}
          </label>
        ))}
      </fieldset>

      {editing ? (
        <Card className="space-y-4">
          {kind === "MoveBudget" ? (
            <>
              <label className={label}>
                Desde
                <select className={field} value={from} onChange={(e) => setFrom(e.target.value)}>
                  {lines.map((l) => (
                    <option key={l.lineId} value={l.lineId}>
                      {l.name}
                      {l.available !== null ? ` (quedan ${formatPesos(l.available)})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Hacia
                <select className={field} value={to} onChange={(e) => setTo(e.target.value)}>
                  {lines.map((l) => (
                    <option key={l.lineId} value={l.lineId}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Monto en pesos
                <input className={field} inputMode="decimal" autoComplete="off" placeholder="100.000" value={moveAmount} onChange={(e) => setMoveAmount(e.target.value)} />
              </label>
              <label className={label}>
                Motivo
                <textarea
                  className={`${field} min-h-24 py-2`}
                  maxLength={500}
                  placeholder="Por ejemplo: rotura de caño en el baño de varones"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </>
          ) : null}

          {kind === "SetBudget" ? (
            <>
              <label className={label}>
                Partida
                <select className={field} value={budgetLine} onChange={(e) => setBudgetLine(e.target.value)}>
                  {lines.map((l) => (
                    <option key={l.lineId} value={l.lineId}>
                      {l.name}
                    </option>
                  ))}
                  <option value="new">Partida nueva…</option>
                </select>
              </label>
              {budgetLine === "new" ? (
                <label className={label}>
                  Nombre de la partida nueva
                  <input className={field} maxLength={60} placeholder="Por ejemplo: Biblioteca" value={newLineName} onChange={(e) => setNewLineName(e.target.value)} />
                  {newLineName.trim() ? <span className={hint}>Identificador: {slugify(newLineName)}</span> : null}
                </label>
              ) : null}
              <label className={label}>
                Monto asignado en pesos
                <input className={field} inputMode="decimal" autoComplete="off" placeholder="500.000" value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} />
                <span className={hint}>Es el total de la partida para el período, no lo que se suma.</span>
              </label>
              <label className={label}>
                Fin del período
                <input className={field} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </label>
            </>
          ) : null}

          {kind === "SetVendor" ? (
            <>
              {vendors.length > 0 ? (
                <label className={label}>
                  Proveedor ya cargado (opcional)
                  <select className={field} defaultValue="" onChange={(e) => pickVendor(e.target.value)}>
                    <option value="">Uno nuevo</option>
                    {vendors.map((v) => (
                      <option key={v.address} value={v.address}>
                        {v.legalName} {v.enabled ? "(habilitado)" : "(dado de baja)"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className={label}>
                Razón social
                <input className={field} maxLength={200} placeholder="Ferretería El Tornillo SRL" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
              </label>
              <label className={label}>
                CUIT
                <input className={field} inputMode="numeric" autoComplete="off" placeholder="30-12345678-9" value={cuit} onChange={(e) => setCuit(e.target.value)} />
              </label>
              <label className={label}>
                Cuenta donde cobra
                {vendorPeople.length > 0 ? (
                  <select className={field} value={vendorPeople.some((p) => p.safeAddress === vendorAddress) ? vendorAddress : "other"} onChange={(e) => setVendorAddress(e.target.value === "other" ? "" : e.target.value)}>
                    {vendorPeople.map((p) => (
                      <option key={p.safeAddress} value={p.safeAddress}>
                        {p.name} ({shortAddress(p.safeAddress)})
                      </option>
                    ))}
                    <option value="other">Otra cuenta…</option>
                  </select>
                ) : null}
                {!vendorPeople.some((p) => p.safeAddress === vendorAddress) ? (
                  <input
                    className={`${field} font-mono text-sm`}
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="0x…"
                    value={vendorAddress}
                    onChange={(e) => setVendorAddress(e.target.value)}
                  />
                ) : null}
                <span className={hint}>Si el proveedor ya creó su firma, elegilo de la lista.</span>
              </label>
              <fieldset className="grid grid-cols-2 gap-2">
                <legend className="mb-1 text-sm font-medium">¿Qué querés hacer?</legend>
                {(
                  [
                    [true, "Habilitar"],
                    [false, "Dar de baja"],
                  ] as const
                ).map(([value, text]) => (
                  <label
                    key={text}
                    className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border text-[15px] font-medium ${
                      enabled === value ? "border-emerald-700 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100" : "border-black/15 dark:border-white/20"
                    }`}
                  >
                    <input type="radio" name="enabled" checked={enabled === value} onChange={() => setEnabled(value)} className="sr-only" />
                    {text}
                  </label>
                ))}
              </fieldset>
            </>
          ) : null}

          {kind === "SetCaps" ? (
            <>
              <p className="text-[15px] text-black/70 dark:text-white/70">
                Hoy el agente paga solo hasta {formatPesos(caps.perTxCap)} por pago y {formatPesos(caps.vendorMonthlyCap)} por proveedor cada 30 días. Lo
                que pasa de ahí necesita firmas.
              </p>
              <label className={label}>
                Nuevo tope por pago, en pesos
                <input className={field} inputMode="decimal" autoComplete="off" placeholder="50.000" value={perTxCap} onChange={(e) => setPerTxCap(e.target.value)} />
              </label>
              <label className={label}>
                Nuevo tope por proveedor cada 30 días, en pesos
                <input className={field} inputMode="decimal" autoComplete="off" placeholder="200.000" value={monthlyCap} onChange={(e) => setMonthlyCap(e.target.value)} />
              </label>
            </>
          ) : null}

          {kind === "Unpause" ? (
            <p className="text-[15px] text-black/75 dark:text-white/75">
              {paused
                ? "Los pagos están pausados. Si la comisión aprueba esta propuesta, vuelven a funcionar."
                : "Los pagos no están pausados, así que no hace falta reanudarlos."}
            </p>
          ) : null}
        </Card>
      ) : null}

      {review ? (
        <Card className="space-y-3">
          <p className="text-sm text-black/60 dark:text-white/60">Vas a proponer</p>
          <p className="text-lg leading-snug font-medium text-pretty">{review.summary}</p>
          {review.meta.newLine ? <p className="text-[15px] text-black/70 dark:text-white/70">Es una partida nueva: «{review.meta.newLine.name}».</p> : null}
          <p className="text-[15px] text-black/70 dark:text-white/70">Se aplica cuando firme la cantidad de personas que pide la cooperadora.</p>
          <Button onClick={() => void submit(review)} disabled={state.status === "working"}>
            {state.status === "working" ? "Firmando…" : "Firmar y proponer"}
          </Button>
          <Button variant="secondary" onClick={() => setReview(null)} disabled={state.status === "working"}>
            Cambiar algo
          </Button>
        </Card>
      ) : (
        <div className="space-y-2">
          <Button onClick={startReview} disabled={kind === "Unpause" && !paused}>
            Revisar
          </Button>
          {error ? <Notice tone="warn">{error}</Notice> : null}
        </div>
      )}

      <ActionStatus state={state} doneText="Listo." />

      {!paused && editing ? (
        <div className="border-t border-black/10 pt-5 dark:border-white/10">
          <p className="mb-3 text-[15px] text-black/70 dark:text-white/70">¿Algo no está bien? Cualquier firmante puede frenar todos los pagos.</p>
          <PauseButton treasury={treasury} signer={signer} />
        </div>
      ) : null}
    </div>
  );
}

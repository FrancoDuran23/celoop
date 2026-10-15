"use client";
import { useState } from "react";
import { encodeFunctionData, type Address } from "viem";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { formatCuit, formatPesos, shortAddress } from "@/lib/wallet/format";
import { buildProposal, slugify, type BuiltProposal, type ProposalInput } from "@/lib/wallet/proposal-builder";
import type { ProposeContext } from "@/lib/wallet/views";
import { ActionStatus } from "../_components/action-status";
import { PauseButton } from "../_components/pause-button";
import { Button, Card, Notice, PageTitle, chip, field, hint, label } from "../_components/ui";
import { useSafeAction, type SignerConfig } from "../_components/use-safe-action";
import { saveProposalMeta } from "./actions";

type Kind = ProposalInput["kind"];

const KINDS: [Kind, string][] = [
  ["MoveBudget", "Move between lines"],
  ["SetBudget", "Add or change a line"],
  ["SetVendor", "Enable or remove a vendor"],
  ["SetCaps", "Change the caps"],
  ["Unpause", "Resume payments"],
];

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
    if (kind === "Unpause" && !paused) return setError("Payments are not paused.");
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
        <PageTitle eyebrow={`Hi, ${name}`}>Proposal sent</PageTitle>
        <Card>
          <p className="text-lg leading-snug font-bold text-pretty">{review.summary}</p>
          <p className="mt-2 text-[15px] text-muted">Your signature already counts. We’ve told the other signers to review it.</p>
        </Card>
        {saveWarning ? <Notice tone="warn">The proposal was recorded, but {saveWarning.toLowerCase()} Let the board know.</Notice> : null}
        <ActionStatus state={state} doneText="Done." />
      </div>
    );
  }

  const editing = !review;

  return (
    <div className="space-y-5">
      <PageTitle eyebrow={`Hi, ${name}`}>Propose a change</PageTitle>

      <fieldset className="grid grid-cols-2 gap-2" disabled={!editing}>
        <legend className="sr-only">Kind of change</legend>
        {KINDS.map(([value, text]) => (
          <label key={value} className={`${chip(kind === value)} last:col-span-2`}>
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
                From
                <select className={field} value={from} onChange={(e) => setFrom(e.target.value)}>
                  {lines.map((l) => (
                    <option key={l.lineId} value={l.lineId}>
                      {l.name}
                      {l.available !== null ? ` (${formatPesos(l.available)} left)` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                To
                <select className={field} value={to} onChange={(e) => setTo(e.target.value)}>
                  {lines.map((l) => (
                    <option key={l.lineId} value={l.lineId}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Amount in pesos
                <input className={field} inputMode="decimal" autoComplete="off" placeholder="100.000" value={moveAmount} onChange={(e) => setMoveAmount(e.target.value)} />
              </label>
              <label className={label}>
                Reason
                <textarea
                  className={`${field} min-h-24 py-2`}
                  maxLength={500}
                  placeholder="For example: burst pipe in the boys' bathroom"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </>
          ) : null}

          {kind === "SetBudget" ? (
            <>
              <label className={label}>
                Budget line
                <select className={field} value={budgetLine} onChange={(e) => setBudgetLine(e.target.value)}>
                  {lines.map((l) => (
                    <option key={l.lineId} value={l.lineId}>
                      {l.name}
                    </option>
                  ))}
                  <option value="new">New line…</option>
                </select>
              </label>
              {budgetLine === "new" ? (
                <label className={label}>
                  Name of the new line
                  <input className={field} maxLength={60} placeholder="For example: Library" value={newLineName} onChange={(e) => setNewLineName(e.target.value)} />
                  {newLineName.trim() ? <span className={hint}>Identifier: {slugify(newLineName)}</span> : null}
                </label>
              ) : null}
              <label className={label}>
                Allocated amount in pesos
                <input className={field} inputMode="decimal" autoComplete="off" placeholder="500.000" value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} />
                <span className={hint}>The line’s total for the period, not an increase.</span>
              </label>
              <label className={label}>
                End of period
                <input className={field} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </label>
            </>
          ) : null}

          {kind === "SetVendor" ? (
            <>
              {vendors.length > 0 ? (
                <label className={label}>
                  Existing vendor (optional)
                  <select className={field} defaultValue="" onChange={(e) => pickVendor(e.target.value)}>
                    <option value="">A new one</option>
                    {vendors.map((v) => (
                      <option key={v.address} value={v.address}>
                        {v.legalName} {v.enabled ? "(enabled)" : "(removed)"}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className={label}>
                Legal name
                <input className={field} maxLength={200} placeholder="Ferretería El Tornillo SRL" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
              </label>
              <label className={label}>
                Tax ID (CUIT)
                <input className={field} inputMode="numeric" autoComplete="off" placeholder="30-12345678-9" value={cuit} onChange={(e) => setCuit(e.target.value)} />
              </label>
              <label className={label}>
                Account that gets paid
                {vendorPeople.length > 0 ? (
                  <select className={field} value={vendorPeople.some((p) => p.safeAddress === vendorAddress) ? vendorAddress : "other"} onChange={(e) => setVendorAddress(e.target.value === "other" ? "" : e.target.value)}>
                    {vendorPeople.map((p) => (
                      <option key={p.safeAddress} value={p.safeAddress}>
                        {p.name} ({shortAddress(p.safeAddress)})
                      </option>
                    ))}
                    <option value="other">Another account…</option>
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
                <span className={hint}>If the vendor already created their signature, pick them from the list.</span>
              </label>
              <fieldset className="grid grid-cols-2 gap-2">
                <legend className="mb-1 text-sm font-bold">What do you want to do?</legend>
                {(
                  [
                    [true, "Enable"],
                    [false, "Remove"],
                  ] as const
                ).map(([value, text]) => (
                  <label key={text} className={chip(enabled === value)}>
                    <input type="radio" name="enabled" checked={enabled === value} onChange={() => setEnabled(value)} className="sr-only" />
                    {text}
                  </label>
                ))}
              </fieldset>
            </>
          ) : null}

          {kind === "SetCaps" ? (
            <>
              <p className="text-[15px] text-muted">
                Today the agent pays on its own up to {formatPesos(caps.perTxCap)} per payment and {formatPesos(caps.vendorMonthlyCap)} per vendor
                every 30 days. Anything above that needs signatures.
              </p>
              <label className={label}>
                New cap per payment, in pesos
                <input className={field} inputMode="decimal" autoComplete="off" placeholder="50.000" value={perTxCap} onChange={(e) => setPerTxCap(e.target.value)} />
              </label>
              <label className={label}>
                New cap per vendor every 30 days, in pesos
                <input className={field} inputMode="decimal" autoComplete="off" placeholder="200.000" value={monthlyCap} onChange={(e) => setMonthlyCap(e.target.value)} />
              </label>
            </>
          ) : null}

          {kind === "Unpause" ? (
            <p className="text-[15px] text-muted">
              {paused
                ? "Payments are paused. If the board approves this proposal, they start again."
                : "Payments are not paused, so there's nothing to resume."}
            </p>
          ) : null}
        </Card>
      ) : null}

      {review ? (
        <Card className="space-y-3">
          <p className="text-sm font-bold text-muted">You’re about to propose</p>
          <p className="text-lg leading-snug font-bold text-pretty">{review.summary}</p>
          {review.meta.newLine ? <p className="text-[15px] text-muted">It’s a new line: “{review.meta.newLine.name}”.</p> : null}
          <p className="text-[15px] text-muted">It applies once enough people have signed, as the co-op requires.</p>
          <Button onClick={() => void submit(review)} disabled={state.status === "working"}>
            {state.status === "working" ? "Signing…" : "Sign and propose"}
          </Button>
          <Button variant="secondary" onClick={() => setReview(null)} disabled={state.status === "working"}>
            Change something
          </Button>
        </Card>
      ) : (
        <div className="space-y-2">
          <Button onClick={startReview} disabled={kind === "Unpause" && !paused}>
            Review
          </Button>
          {error ? <Notice tone="warn">{error}</Notice> : null}
        </div>
      )}

      <ActionStatus state={state} doneText="Done." />

      {!paused && editing ? (
        <div className="border-t-[3px] border-ink pt-5">
          <p className="mb-3 text-[15px] text-muted">Something wrong? Any signer can stop every payment.</p>
          <PauseButton treasury={treasury} signer={signer} />
        </div>
      ) : null}
    </div>
  );
}

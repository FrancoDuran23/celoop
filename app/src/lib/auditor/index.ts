// The auditor: a second agent with its own key and its own ERC-8004 identity. It reviews every
// payment the treasurer proposes before it can go out automatically, and once a day checks that
// the treasury's balance matches the recorded movements.
//
// On chain it can only call auditPayment: clear a payment (it then goes out if it fits the
// automatic limits) or flag it (it then needs the signers). It can hold money back, never move it.
//
// Per pending payment, under the "auditor" lock:
//   read the payment from the chain → load the stored file, re-read its QR, look at the vendor's
//   history → findings → report (stored, hash on chain) → auditPayment → tell the revisor if flagged.
// The report is written before the transaction, so a retry sends the same verdict and hash.
import { and, desc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { isAddressEqual, keccak256, zeroAddress, type Address, type Hex } from "viem";
import { audits, chainEvents, contributions, cooperadora, indexerCursor, invoices, payments, vendors } from "@/db/schema";
import { withLock } from "@/lib/locks";
import { activeCooperadoras, auditorLock, readJobCursor, rotateAfter, scopedKey, writeJobCursor, type CoopRow } from "@/lib/tenant";
import { claimNotice, releaseNotice } from "@/lib/orchestrator/chat-state";
import { notifyOnce } from "@/lib/orchestrator/deps";
import { arDate, errorText, formatPesos, invoiceLabel } from "@/lib/orchestrator/format";
import { urls } from "@/lib/orchestrator/links";
import { OPERATOR_ROLE, personsWithRoles, REVIEWER_ROLE } from "@/lib/orchestrator/people";
import { isFlagged, runChecks, type Finding, type PastPayment } from "./checks";
import type { AuditorDeps } from "./deps";
import { buildAuditReport } from "./report";

export { runChecks, isFlagged, type Finding, type FindingCode, type FindingLevel } from "./checks";
export { buildAuditReport, reportHash, REPORT_KIND, type AuditReport } from "./report";
export { defaultAuditorDeps, type AuditorDeps, type AuditorChain } from "./deps";

export const AUDITOR_LOCK = "auditor";
export const AUDITOR_LOCK_MS = 300_000;
/** The auditor's sends are serialized among themselves (its own nonce), never with the agent's. */
export const AUDITOR_TX_LOCK = "auditor-tx";
const AUDITOR_TX_LOCK_MS = 120_000;
/** chat_state row for once-only markers (shared with the agent; keys are prefixed). */
const STATE_CHAT = BigInt(0);

export type AuditResult = {
  paymentId: string;
  verdict: "cleared" | "flagged";
  /** executed = paid automatically by the clearance; recorded = verdict on chain, still pending. */
  status: "executed" | "recorded" | "dry-run" | "busy";
  txHash?: Hex;
};

export type AuditorSummary =
  | { ok: true; audited: AuditResult[]; retry: number; reconcile: ReconcileResult }
  | { ok: true; skipped: string };

const AUDITOR_BUDGET_MS = 240_000;

function forCooperadora(deps: AuditorDeps, coop: CoopRow): AuditorDeps {
  const treasury = coop.treasuryAddress as Address | null;
  const chain = treasury && deps.chainFor ? deps.chainFor(treasury) : deps.chain;
  return { ...deps, cooperadoraId: coop.id, chain };
}

export async function runAuditor(deps: AuditorDeps): Promise<AuditorSummary | { skipped: true }> {
  const coops = await activeCooperadoras(deps.db);
  if (coops.length <= 1) {
    const coop = coops[0];
    const scoped = coop ? forCooperadora(deps, coop) : deps;
    return withLock(deps.db, coop ? auditorLock(coop.id) : AUDITOR_LOCK, AUDITOR_LOCK_MS, () => auditCooperadora(scoped));
  }

  const started = Date.now();
  const ordered = rotateAfter(coops, await readJobCursor(deps.db, "auditor"));
  const audited: AuditResult[] = [];
  let retry = 0;
  let reconcile: ReconcileResult = { ran: false };
  let ran = 0;
  let skipped = 0;
  for (const coop of ordered) {
    if (ran > 0 && Date.now() - started > AUDITOR_BUDGET_MS) break;
    const result = await withLock(deps.db, auditorLock(coop.id), AUDITOR_LOCK_MS, () =>
      auditCooperadora(forCooperadora(deps, coop)),
    );
    if (result && typeof result === "object" && "skipped" in result && !("ok" in result)) {
      skipped++;
      continue;
    }
    ran++;
    const summary = result as AuditorSummary;
    if ("audited" in summary) {
      audited.push(...summary.audited);
      retry += summary.retry;
      reconcile = summary.reconcile;
    }
    await writeJobCursor(deps.db, "auditor", coop.id);
  }
  if (ran === 0) return skipped > 0 ? { skipped: true } : { ok: true, skipped: "no hay cooperadoras activas" };
  return { ok: true, audited, retry, reconcile };
}

async function auditCooperadora(deps: AuditorDeps): Promise<AuditorSummary> {
  const self = await deps.chain.self();
    const trusted = await deps.chain.treasuryAuditor();
    if (isAddressEqual(trusted, zeroAddress)) return { ok: true as const, skipped: "el tesoro no tiene auditor" };
    if (!isAddressEqual(trusted, self)) {
      await alertOperators(
        deps,
        `auditor-mismatch:${trusted.toLowerCase()}`,
        `Atención operador: la clave del auditor (${self}) no es la que el contrato reconoce como auditor (${trusted}). No reviso pagos hasta que coincidan.`,
      );
      return { ok: true as const, skipped: "la clave no es la del auditor del contrato" };
    }

    const audited: AuditResult[] = [];
    let retry = 0;
    for (const paymentId of await candidates(deps)) {
      try {
        const r = await auditOne(deps, paymentId, self);
        if (r === "retry") retry++;
        else if (r) audited.push(r);
      } catch (e) {
        console.error(`auditor: payment ${paymentId}: ${errorText(e)}`);
        retry++;
      }
    }
    const reconcile = await reconcileBalance(deps).catch((e): ReconcileResult => {
      console.error(`auditor: reconcile: ${errorText(e)}`);
      return { ran: false, error: errorText(e) };
    });
    return { ok: true as const, audited, retry, reconcile };
}

type AuditRow = typeof audits.$inferSelect;

/**
 * Payments to look at: the indexed ones still pending without a verdict, plus every id the
 * contract issued after the newest indexed one (the treasurer may have just proposed it).
 */
async function candidates(deps: AuditorDeps): Promise<bigint[]> {
  const indexed = await deps.db
    .select({ paymentId: payments.paymentId })
    .from(payments)
    .where(
      and(
        eq(payments.status, "pending"),
        isNull(payments.audit),
        deps.cooperadoraId == null ? undefined : eq(payments.cooperadoraId, deps.cooperadoraId),
      ),
    )
    .orderBy(payments.paymentId);
  const [{ max }] = await deps.db
    .select({ max: sql<string | null>`max(${payments.paymentId})::text` })
    .from(payments)
    .where(deps.cooperadoraId == null ? undefined : eq(payments.cooperadoraId, deps.cooperadoraId));
  const ids = new Set(indexed.map((r) => r.paymentId));
  const count = await deps.chain.paymentCount();
  for (let id = BigInt(max ?? "0") + BigInt(1); id <= count; id++) ids.add(id);
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

async function auditOne(deps: AuditorDeps, paymentId: bigint, self: Address): Promise<AuditResult | "retry" | null> {
  const { db } = deps;
  // The chain is the source of truth: the index may lag behind.
  const onchain = await deps.chain.payment(paymentId);
  if (onchain.status !== "pending") return null;
  if ((await deps.chain.paymentAudit(paymentId)).status !== "none") return null;

  const auditWhere = and(
    eq(audits.paymentId, paymentId),
    deps.cooperadoraId == null ? undefined : eq(audits.cooperadoraId, deps.cooperadoraId),
  );
  let [row] = await db.select().from(audits).where(auditWhere);
  if (!row) {
    const built = await review(deps, paymentId, onchain, self);
    if (built === "retry") return "retry";
    await db.insert(audits).values({ ...built, ...(deps.cooperadoraId == null ? {} : { cooperadoraId: deps.cooperadoraId }) }).onConflictDoNothing();
    [row] = await db.select().from(audits).where(auditWhere);
  }
  const cleared = row.verdict === "cleared";

  let status: AuditResult["status"];
  let txHash: Hex | undefined;
  try {
    const res = await withLock(db, AUDITOR_TX_LOCK, AUDITOR_TX_LOCK_MS, () =>
      deps.chain.auditPayment(
        { key: scopedKey(deps.cooperadoraId, `audit:payment:${paymentId}`), paymentId, cleared, reportHash: row.reportHash as Hex },
        db,
      ),
    );
    if ("skipped" in res) return { paymentId: paymentId.toString(), verdict: row.verdict as AuditResult["verdict"], status: "busy" };
    status = res.status;
    txHash = res.txHash;
  } catch (e) {
    if (e instanceof Error && e.name === "AgentTxPendingError") {
      return { paymentId: paymentId.toString(), verdict: row.verdict as AuditResult["verdict"], status: "busy" };
    }
    throw e;
  }

  if (!cleared && status !== "dry-run") await tellReviewers(deps, row, onchain);
  return { paymentId: paymentId.toString(), verdict: row.verdict as AuditResult["verdict"], status, txHash };
}

/** Gathers what the checks need, on the auditor's own account: chain, stored file, history. */
async function review(
  deps: AuditorDeps,
  paymentId: bigint,
  onchain: Awaited<ReturnType<AuditorDeps["chain"]["payment"]>>,
  self: Address,
): Promise<Omit<AuditRow, "createdAt"> | "retry"> {
  const { db } = deps;
  const [coop] = await db
    .select()
    .from(cooperadora)
    .where(deps.cooperadoraId == null ? undefined : eq(cooperadora.id, deps.cooperadoraId));
  if (!coop) throw new Error("cooperadora is not configured");

  const [inv] = await db
    .select()
    .from(invoices)
    .where(
      and(
        sql`lower(${invoices.invoiceId}) = ${onchain.invoiceId.toLowerCase()}`,
        deps.cooperadoraId == null ? undefined : eq(invoices.cooperadoraId, deps.cooperadoraId),
      ),
    );
  let storedFileHash: Hex | null = null;
  let qr = null;
  if (inv) {
    let file;
    try {
      file = await deps.loadFile(inv.fileUrl);
    } catch (e) {
      // Can't see the file right now: try again on the next round rather than guess.
      console.error(`auditor: payment ${paymentId}: file: ${errorText(e)}`);
      return "retry";
    }
    storedFileHash = keccak256(file.bytes);
    qr = await deps.readQr(file);
  }

  const findings = runChecks({
    payment: { paymentId, vendor: onchain.vendor, amount: onchain.amount, invoiceId: onchain.invoiceId, fileHash: onchain.fileHash },
    hasInvoice: Boolean(inv),
    storedFileHash,
    qr,
    cooperadoraCuit: coop.cuit,
    perTxCap: await deps.chain.perTxCap(),
    history: await vendorHistory(deps, onchain.vendor, paymentId),
    now: deps.now(),
  });
  const { json, hash } = buildAuditReport({
    chainId: await deps.chain.chainId(),
    treasury: deps.chain.treasuryAddress(),
    auditor: self,
    paymentId,
    payment: onchain,
    findings,
    checkedAt: deps.now(),
  });
  return {
    cooperadoraId: deps.cooperadoraId ?? 1,
    paymentId,
    verdict: isFlagged(findings) ? "flagged" : "cleared",
    findings,
    reportJson: json,
    reportHash: hash,
  };
}

/** Earlier payments to the same vendor that were not rejected, most recent first. */
async function vendorHistory(deps: AuditorDeps, vendor: Address, before: bigint): Promise<PastPayment[]> {
  const rows = await deps.db
    .select()
    .from(payments)
    .where(
      and(
        sql`lower(${payments.vendor}) = ${vendor.toLowerCase()}`,
        lt(payments.paymentId, before),
        ne(payments.status, "rejected"),
        deps.cooperadoraId == null ? undefined : eq(payments.cooperadoraId, deps.cooperadoraId),
      ),
    )
    .orderBy(desc(payments.paymentId));
  if (rows.length === 0) return [];
  const txs = rows.map((r) => r.proposedTxHash).filter((h): h is string => Boolean(h));
  const times = new Map(
    (txs.length
      ? await deps.db.select({ txHash: chainEvents.txHash, at: chainEvents.blockTime }).from(chainEvents).where(inArray(chainEvents.txHash, txs))
      : []
    ).map((e) => [e.txHash.toLowerCase(), e.at]),
  );
  const labels = new Map(
    (
      await deps.db
        .select({ invoiceId: invoices.invoiceId, tipo: invoices.tipo, ptoVta: invoices.ptoVta, nro: invoices.nro })
        .from(invoices)
        .where(inArray(sql`lower(${invoices.invoiceId})`, rows.map((r) => r.invoiceId.toLowerCase())))
    ).map((i) => [i.invoiceId!.toLowerCase(), invoiceLabel(i)]),
  );
  return rows.map((r) => ({
    paymentId: r.paymentId,
    amount: BigInt(r.amount),
    at: (r.proposedTxHash && times.get(r.proposedTxHash.toLowerCase())) || r.executedAt || r.updatedAt,
    invoiceLabel: labels.get(r.invoiceId.toLowerCase()) ?? null,
  }));
}

type Onchain = Awaited<ReturnType<AuditorDeps["chain"]["payment"]>>;

async function describePayment(deps: AuditorDeps, paymentId: bigint, p: Onchain): Promise<string> {
  const [v] = await deps.db.select().from(vendors).where(sql`lower(${vendors.address}) = ${p.vendor.toLowerCase()}`);
  const [inv] = await deps.db.select().from(invoices).where(sql`lower(${invoices.invoiceId}) = ${p.invoiceId.toLowerCase()}`);
  const what = inv ? invoiceLabel(inv) : "un comprobante que no está en el sistema";
  return `el pago #${paymentId} (${what}${v ? ` de ${v.legalName}` : ""} por ${formatPesos(p.amount)})`;
}

async function tellReviewers(deps: AuditorDeps, row: AuditRow, onchain: Onchain) {
  const findings = (row.findings as Finding[]).filter((f) => f.level === "observacion");
  const text =
    `Auditor: revisé ${await describePayment(deps, row.paymentId, onchain)} y no lo dejé salir automático.\n` +
    findings.map((f) => `• ${f.text}`).join("\n") +
    `\nAhora lo tienen que firmar o rechazar los firmantes. Informe: ${urls.audit(deps.appUrl, row.paymentId, deps.cooperadoraId)}`;
  for (const r of await personsWithRoles(deps.db, [REVIEWER_ROLE], deps.cooperadoraId)) {
    await notifyOnce(deps, r.id, `audit-flag:${row.paymentId}`, text);
  }
}

async function alertOperators(deps: AuditorDeps, key: string, text: string) {
  console.error(text);
  for (const op of await personsWithRoles(deps.db, [OPERATOR_ROLE], deps.cooperadoraId)) await notifyOnce(deps, op.id, key, text);
}

export type ReconcileResult =
  | { ran: false; error?: string }
  | { ran: true; block: string; onchain: string; recorded: string; matches: boolean };

/**
 * Once a day (Argentine date): the treasury's balance on chain, at the last indexed block, must
 * equal money contributions minus executed payments as recorded. A difference goes to the revisor
 * and the operator. If the index moves while counting, it tries again next round.
 */
export async function reconcileBalance(deps: AuditorDeps): Promise<ReconcileResult> {
  const { db } = deps;
  const marker = `auditor:reconcile:${deps.cooperadoraId ?? "all"}:${arDate(deps.now())}`;
  if (!(await claimNotice(db, STATE_CHAT, marker))) return { ran: false };
  try {
    const cursor = async () =>
      (
        await db
          .select()
          .from(indexerCursor)
          .where(
            and(
              eq(indexerCursor.key, "treasury"),
              deps.cooperadoraId == null ? undefined : eq(indexerCursor.cooperadoraId, deps.cooperadoraId),
            ),
          )
      )[0]?.blockNumber ?? null;
    const block = await cursor();
    if (block === null) {
      await releaseNotice(db, STATE_CHAT, marker);
      return { ran: false };
    }
    const [{ income }] = await db
      .select({ income: sql<string>`coalesce(sum(${contributions.amount}), 0)::text` })
      .from(contributions)
      .where(
        and(
          eq(contributions.kind, "dinero"),
          sql`${contributions.txHash} is not null`,
          sql`${contributions.blockNumber} <= ${block}`,
          deps.cooperadoraId == null ? undefined : eq(contributions.cooperadoraId, deps.cooperadoraId),
        ),
      );
    const [{ paid }] = await db
      .select({ paid: sql<string>`coalesce(sum(${payments.amount}), 0)::text` })
      .from(payments)
      .where(and(eq(payments.status, "executed"), deps.cooperadoraId == null ? undefined : eq(payments.cooperadoraId, deps.cooperadoraId)));
    if ((await cursor()) !== block) {
      await releaseNotice(db, STATE_CHAT, marker);
      return { ran: false };
    }
    const recorded = BigInt(income) - BigInt(paid);
    const onchain = await deps.chain.treasuryBalanceAt(block);
    const matches = onchain === recorded;
    if (!matches) {
      const diff = onchain > recorded ? onchain - recorded : recorded - onchain;
      const text =
        `Auditor: el saldo del tesoro no cierra. En la cadena hay ${formatPesos(onchain)} y, según los aportes y pagos registrados, ` +
        `tendría que haber ${formatPesos(recorded)} (diferencia de ${formatPesos(diff)}). Hay que revisarlo antes de la próxima rendición.`;
      for (const p of await personsWithRoles(db, [REVIEWER_ROLE, OPERATOR_ROLE], deps.cooperadoraId)) {
        await notifyOnce(deps, p.id, `reconcile:${arDate(deps.now())}`, text);
      }
    }
    return { ran: true, block: block.toString(), onchain: onchain.toString(), recorded: recorded.toString(), matches };
  } catch (e) {
    await releaseNotice(db, STATE_CHAT, marker);
    throw e;
  }
}

// Invoice orchestration. The money path is deterministic: code reads, validates and proposes;
// the person who uploads picks the budget line; the contract decides auto-pay vs. signatures.
// With an auditor on the contract, a proposed payment waits for its verdict first (auditando):
// cleared and within the limits → paid; cleared but over them, or flagged → signatures.
//
//   recibida → leida → validada | rechazada(motivo) | revision(motivo)
//   validada → (partida) → propuesta → pagada | pendiente → aprobada → pagada | cancelada
//   propuesta → auditando → pagada | pendiente (as above) | cancelada
//
// invoices.invoiceId is set only once an invoice validates, so the unique index on it doubles as
// the duplicate guard: rejected uploads never block a corrected re-upload.
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { agentTxs, audits, budgetIndex, budgetLines, chainEvents, cooperadora, invoices, payments, vendors } from "@/db/schema";
import type { AuditStatus, PaymentStatus } from "@/lib/chain/treasury";
import type { InlineButton } from "@/lib/bot/notify";
import {
  fileHashOf,
  invoiceIdOf,
  looksLikeInjection,
  toWarsUnits,
  validateInvoice,
  type InvoiceFile,
  type ReadResult,
} from "@/lib/invoice";
import { withLock } from "@/lib/locks";
import { explorerTxUrl } from "@/lib/report/format";
import type { AgentDeps } from "./deps";
import { arDate, collectStrings, errorText, formatPesos, invoiceLabel, jsonSafe } from "./format";
import { enrollUrl, paymentSignUrl, urls } from "./links";
import { sendReviewCards } from "./review-card";
import {
  canManageInvoices,
  OPERATOR_ROLE,
  personById,
  personsWithRoles,
  REVIEWER_ROLE,
  SIGNER_ROLES,
  type Person,
} from "./people";
import { notifyOnce } from "./deps";

export type InvoiceRow = typeof invoices.$inferSelect;

/** Every agent send is serialized under this lock so two sends never race for a nonce. */
export const AGENT_TX_LOCK = "agent-tx";
export const AGENT_TX_LOCK_MS = 120_000;
/** A payment the auditor hasn't reviewed after this long goes to the signers anyway. */
export const AUDIT_TIMEOUT_MS = 15 * 60 * 1000;

export const INJECTION_REASON = "La factura tiene instrucciones de pago en el texto; la reviso con una persona";
const TECH_REASON = "Tuve un problema técnico al procesar la factura. Probá mandarla de nuevo en unos minutos";
const CONTRACT_REASON =
  "El tesoro no aceptó el pago (puede estar en pausa o el proveedor no estar habilitado en el contrato); la reviso con una persona";

const STATUS_TEXT: Record<string, string> = {
  validada: "esperando que elijan la partida",
  propuesta: "con el pago en curso",
  auditando: "esperando la revisión del auditor",
  pendiente: "esperando firmas",
  aprobada: "con las firmas, por pagarse",
  pagada: "pagada",
  cancelada: "rechazada por los firmantes",
};

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function setStatus(deps: AgentDeps, id: number, status: string, reason: string | null = null) {
  await deps.db
    .update(invoices)
    .set({ status, statusReason: reason, updatedAt: deps.now() })
    .where(eq(invoices.id, id));
}

/** Moves an invoice from one of `from` to `to` atomically. Returns the row only for the winner. */
async function transition(
  deps: AgentDeps,
  id: number,
  from: string[],
  set: Partial<InvoiceRow> & { status: string },
): Promise<InvoiceRow | undefined> {
  const [row] = await deps.db
    .update(invoices)
    .set({ ...set, updatedAt: deps.now() })
    .where(and(eq(invoices.id, id), inArray(invoices.status, from)))
    .returning();
  return row;
}

async function vendorOf(deps: AgentDeps, inv: InvoiceRow) {
  if (!inv.vendorId) return undefined;
  const [v] = await deps.db.select().from(vendors).where(eq(vendors.id, inv.vendorId));
  return v;
}

async function lineOf(deps: AgentDeps, lineId: string | null) {
  if (!lineId) return undefined;
  const [l] = await deps.db.select().from(budgetLines).where(eq(budgetLines.lineId, lineId));
  return l;
}

async function txLink(deps: AgentDeps, txHash: string | null | undefined): Promise<string> {
  const [coop] = await deps.db.select({ chainId: cooperadora.chainId }).from(cooperadora);
  return explorerTxUrl(coop?.chainId, txHash) ?? urls.panel(deps.appUrl);
}

/** "Factura C 0003-00001234 de Librería El Aula por $ 4.000,00" */
export async function describe(deps: AgentDeps, inv: InvoiceRow): Promise<string> {
  // Rows not validated yet have no vendorId; the CUIT still names the issuer for the message.
  const v =
    (await vendorOf(deps, inv)) ??
    (inv.cuit !== null ? (await deps.db.select().from(vendors).where(eq(vendors.cuit, inv.cuit)))[0] : undefined);
  const who = v ? ` de ${v.legalName}` : "";
  const amount = inv.amount ? ` por ${formatPesos(inv.amount)}` : "";
  const label = invoiceLabel(inv);
  return `${label.charAt(0).toLowerCase()}${label.slice(1)}${who}${amount}`;
}

async function notifyReviewers(deps: AgentDeps, text: string, buttons?: InlineButton[][]) {
  for (const r of await personsWithRoles(deps.db, [REVIEWER_ROLE])) await deps.notify(r.id, text, buttons);
}

async function toRejected(deps: AgentDeps, inv: InvoiceRow, reason: string) {
  await setStatus(deps, inv.id, "rechazada", reason);
  await deps.notify(inv.uploaderPersonId, `No puedo pagar esta factura: ${reason}.`);
  return { invoiceId: inv.id, status: "rechazada" as const, reason };
}

async function toReview(deps: AgentDeps, inv: InvoiceRow, reason: string) {
  await setStatus(deps, inv.id, "revision", reason);
  await deps.notify(
    inv.uploaderPersonId,
    `${reason}. No la pago por ahora; ya le avisé al revisor de cuentas para que la mire.`,
  );
  const [row] = await deps.db.select().from(invoices).where(eq(invoices.id, inv.id));
  await sendReviewCards(deps, row);
  return { invoiceId: inv.id, status: "revision" as const, reason };
}

export type InvoiceOutcome = { invoiceId: number; status: string; reason?: string };

/**
 * Steps 1–4: stores the file, reads it, screens it, validates it and asks for the budget line.
 * The uploader must be comisión or revisor (the bot checks before calling).
 */
export async function processInvoice(
  deps: AgentDeps,
  upload: { uploaderPersonId: number; file: InvoiceFile },
): Promise<InvoiceOutcome> {
  const { db } = deps;
  const { file } = upload;
  const fileHash = fileHashOf(file.bytes);
  const ext = MIME_EXT[file.mimeType] ?? "bin";
  const fileUrl = await deps.storeFile(`facturas/${fileHash.slice(2)}.${ext}`, file.bytes, file.mimeType);
  const [inv] = await db
    .insert(invoices)
    .values({ uploaderPersonId: upload.uploaderPersonId, status: "recibida", fileUrl, fileHash })
    .returning();

  try {
    return await readAndValidate(deps, inv, file);
  } catch (e) {
    console.error(`invoice ${inv.id}: ${errorText(e)}`);
    return toRejected(deps, inv, TECH_REASON);
  }
}

async function readAndValidate(deps: AgentDeps, inv: InvoiceRow, file: InvoiceFile): Promise<InvoiceOutcome> {
  const { db } = deps;
  let read: ReadResult;
  try {
    read = await deps.readInvoice(file);
  } catch (e) {
    console.error(`invoice ${inv.id}: read failed: ${errorText(e)}`);
    read = { ok: false, reason: "No pude leer la factura. Mandá el PDF original o una foto más nítida, con el código QR a la vista" };
  }
  if (!read.ok) {
    // Module 02 asks for human review when the QR and the LLM disagree.
    return /revis/i.test(read.reason) ? toReview(deps, inv, read.reason) : toRejected(deps, inv, read.reason);
  }

  const f = read.fields;
  let amount: string | null = null;
  try {
    amount = toWarsUnits(f.importe).toString();
  } catch {
    amount = null;
  }
  const [leida] = await db
    .update(invoices)
    .set({
      status: "leida",
      source: read.source,
      cuit: f.cuit,
      tipo: f.tipo,
      ptoVta: f.ptoVta,
      nro: f.nro,
      amount,
      amountPesos: f.importe,
      issuedOn: f.fecha,
      receptorDocTipo: f.receptorDocTipo,
      receptorDocNro: f.receptorDocNro,
      cae: f.cae,
      extracted: jsonSafe(read.raw) as Record<string, unknown>,
      updatedAt: deps.now(),
    })
    .where(eq(invoices.id, inv.id))
    .returning();

  // The invoice text is data. Anything that reads like payment instructions goes to a person.
  if (looksLikeInjection(collectStrings(read.raw).join("\n"))) return toReview(deps, leida, INJECTION_REASON);

  const [coop] = await db.select().from(cooperadora);
  if (!coop) throw new Error("cooperadora is not configured");
  const enabled = await db.select().from(vendors).where(eq(vendors.enabled, true));
  const invoiceId = invoiceIdOf(f);
  let existing: InvoiceRow | undefined;

  const validation = await validateInvoice(f, {
    cooperadoraCuit: coop.cuit,
    enabledVendorCuits: new Set(enabled.map((v) => v.cuit)),
    alreadyPaid: async () => {
      [existing] = await db.select().from(invoices).where(eq(invoices.invoiceId, invoiceId));
      if (existing) return true;
      return deps.chain.isInvoicePaid(invoiceId);
    },
    today: arDate(deps.now()),
  });

  if (!validation.ok) {
    if (validation.code === "YA_PAGADA" && existing) {
      const state = STATUS_TEXT[existing.status] ?? existing.status;
      const out = await toRejected(deps, leida, `esta factura ya se cargó antes y está ${state}`);
      if (existing.status === "validada") await askForLine(deps, existing);
      return out;
    }
    return toRejected(deps, leida, validation.reason);
  }

  const vendor = enabled.find((v) => v.cuit === f.cuit)!;
  let validada: InvoiceRow;
  try {
    [validada] = await db
      .update(invoices)
      .set({ status: "validada", invoiceId, vendorId: vendor.id, statusReason: null, updatedAt: deps.now() })
      .where(eq(invoices.id, inv.id))
      .returning();
  } catch {
    // Unique index on invoice_id: the same invoice validated a moment ago in another upload.
    return toRejected(deps, leida, "esta factura ya se cargó antes");
  }
  await askForLine(deps, validada);
  return { invoiceId: inv.id, status: "validada" };
}

/** The line the agent suggests: the one used last time with this vendor. */
export async function suggestLine(deps: AgentDeps, inv: InvoiceRow): Promise<string | null> {
  if (inv.vendorId) {
    const [last] = await deps.db
      .select({ lineId: invoices.lineId })
      .from(invoices)
      .where(
        and(
          eq(invoices.vendorId, inv.vendorId),
          isNotNull(invoices.lineId),
          inArray(invoices.status, ["pagada", "pendiente", "aprobada", "auditando"]),
        ),
      )
      .orderBy(desc(invoices.updatedAt))
      .limit(1);
    if (last?.lineId) return last.lineId;
  }
  const v = await vendorOf(deps, inv);
  if (v) {
    const [p] = await deps.db
      .select({ lineId: payments.lineId })
      .from(payments)
      .where(and(eq(payments.vendor, v.address), eq(payments.status, "executed")))
      .orderBy(desc(payments.executedAt))
      .limit(1);
    if (p) return p.lineId;
  }
  return null;
}

/** Step 4: buttons with the budget lines, the suggested one first. */
export async function askForLine(deps: AgentDeps, inv: InvoiceRow): Promise<void> {
  const lines = await deps.db
    .select({ lineId: budgetLines.lineId, slug: budgetLines.slug, name: budgetLines.name, allocated: budgetIndex.allocated, spent: budgetIndex.spent })
    .from(budgetLines)
    .leftJoin(budgetIndex, eq(budgetIndex.lineId, budgetLines.lineId))
    .orderBy(budgetLines.name);
  const suggested = await suggestLine(deps, inv);
  const sorted = [...lines].sort((a, b) => Number(b.lineId === suggested) - Number(a.lineId === suggested));
  const buttons: InlineButton[][] = sorted.map((l) => {
    const available = l.allocated ? BigInt(l.allocated) - BigInt(l.spent ?? "0") : null;
    const extra = available !== null ? ` · quedan ${formatPesos(available > BigInt(0) ? available : BigInt(0))}` : "";
    return [{ text: `${l.name}${l.lineId === suggested ? " (sugerida)" : ""}${extra}`, data: `line:${inv.id}:${l.slug}` }];
  });
  const suggestion = sorted.find((l) => l.lineId === suggested);
  const text =
    `Leí la ${await describe(deps, inv)}. Está a nombre de la cooperadora y el proveedor está habilitado.\n\n` +
    `¿De qué partida sale?` +
    (suggestion ? ` Te sugiero ${suggestion.name}, que es la que se usó la última vez con este proveedor.` : "");
  await deps.notify(inv.uploaderPersonId, text, buttons);
}

/** The uploader (or anyone in the comisión) picked the line: propose the payment. */
export async function chooseLine(
  deps: AgentDeps,
  args: { personId: number; invoiceRowId: number; slug: string },
): Promise<InvoiceOutcome> {
  const person = await personById(deps.db, args.personId);
  const [inv] = await deps.db.select().from(invoices).where(eq(invoices.id, args.invoiceRowId));
  if (!person || !inv || !(canManageInvoices(person) || person.id === inv.uploaderPersonId)) {
    if (person) await deps.notify(person.id, "Esa factura no la podés gestionar vos.");
    return { invoiceId: args.invoiceRowId, status: inv?.status ?? "desconocida" };
  }
  const [line] = await deps.db.select().from(budgetLines).where(eq(budgetLines.slug, args.slug));
  if (!line) {
    await deps.notify(person.id, "No encuentro esa partida. Probá de nuevo con los botones.");
    return { invoiceId: inv.id, status: inv.status };
  }
  const claimed = await transition(deps, inv.id, ["validada"], { status: "propuesta", lineId: line.lineId, statusReason: null });
  if (!claimed) {
    await deps.notify(person.id, `Esa factura ya está ${STATUS_TEXT[inv.status] ?? inv.status}.`);
    return { invoiceId: inv.id, status: inv.status };
  }
  return proposeInvoice(deps, claimed, { first: true });
}

function isPendingTxError(e: unknown): boolean {
  return e instanceof Error && e.name === "AgentTxPendingError";
}

/**
 * Step 5: proposePayment with key propose:invoice:<id>. Called after the line is chosen and,
 * for invoices left in `propuesta` (lock busy or receipt not in yet), again by the tick.
 */
export async function proposeInvoice(
  deps: AgentDeps,
  inv: InvoiceRow,
  opts: { first?: boolean } = {},
): Promise<InvoiceOutcome> {
  const vendor = await vendorOf(deps, inv);
  if (!vendor || !inv.lineId || !inv.amount || inv.cuit === null || inv.tipo === null || inv.ptoVta === null || inv.nro === null) {
    return toReview(deps, inv, "Faltan datos de la factura para armar el pago; la reviso con una persona");
  }
  const busy = async () => {
    if (opts.first) {
      await deps.notify(inv.uploaderPersonId, "Estoy terminando otro envío. En un ratito mando este pago y te aviso.");
    }
    return { invoiceId: inv.id, status: "propuesta" };
  };

  let result;
  try {
    result = await withLock(deps.db, AGENT_TX_LOCK, AGENT_TX_LOCK_MS, () =>
      deps.chain.proposePayment(
        {
          key: `propose:invoice:${inv.id}`,
          vendor: vendor.address as Address,
          invoice: { cuit: inv.cuit!, tipo: inv.tipo!, ptoVta: inv.ptoVta!, nro: inv.nro! },
          amount: BigInt(inv.amount!),
          lineId: inv.lineId as Hex,
          fileHash: inv.fileHash as Hex,
        },
        deps.db,
      ),
    );
  } catch (e) {
    if (isPendingTxError(e)) return busy();
    console.error(`invoice ${inv.id}: proposePayment failed: ${errorText(e)}`);
    return toReview(deps, inv, CONTRACT_REASON);
  }
  if ("skipped" in result) return busy();

  if (result.status === "dry-run") {
    await transition(deps, inv.id, ["propuesta"], { status: "validada", statusReason: "modo de prueba: el pago no se envió" });
    await deps.notify(
      inv.uploaderPersonId,
      "Estoy en modo de prueba, así que no envié el pago. La simulación salió bien.",
    );
    return { invoiceId: inv.id, status: "validada", reason: "dry-run" };
  }

  const paymentId = result.paymentId ?? null;
  const line = await lineOf(deps, inv.lineId);
  const what = await describe(deps, inv);

  if (result.status === "executed") {
    const row = await transition(deps, inv.id, ["propuesta"], { status: "pagada", paymentId });
    if (!row) return { invoiceId: inv.id, status: "pagada" };
    await announceAutoPaid(deps, row, result.txHash ?? null, false);
    return { invoiceId: inv.id, status: "pagada" };
  }

  if (result.status === "auditing") {
    const row = await transition(deps, inv.id, ["propuesta"], { status: "auditando", paymentId });
    if (!row || paymentId === null) return { invoiceId: inv.id, status: "auditando" };
    await deps.notify(
      inv.uploaderPersonId,
      `Propuse el pago de la ${what}, de la partida ${line?.name ?? "elegida"}. Antes de que salga lo revisa el auditor, ` +
        `que es otro agente con su propia llave. Te aviso apenas termine.`,
    );
    if (!deps.auditNow) return { invoiceId: inv.id, status: "auditando" };
    try {
      await deps.auditNow();
    } catch (e) {
      console.error(`invoice ${inv.id}: auditor: ${errorText(e)}`);
    }
    // Only what the contract says counts, not what the auditor's run reported.
    let state;
    try {
      state = await deps.chain.paymentState(paymentId);
    } catch (e) {
      console.error(`invoice ${inv.id}: paymentState: ${errorText(e)}`);
      return { invoiceId: inv.id, status: "auditando" };
    }
    return advanceAudited(deps, row, { ...state, txHash: await auditTxHash(deps, paymentId) });
  }

  // Pending: it needs signatures.
  const row = await transition(deps, inv.id, ["propuesta"], { status: "pendiente", paymentId });
  if (!row) return { invoiceId: inv.id, status: "pendiente" };
  await toSignatures(deps, row);
  return { invoiceId: inv.id, status: "pendiente" };
}

/** "Listo, pagué…" to the uploader and the heads-up to the revisor, for an automatic payment. */
async function announceAutoPaid(deps: AgentDeps, inv: InvoiceRow, txHash: string | null, audited: boolean) {
  const line = await lineOf(deps, inv.lineId);
  const what = await describe(deps, inv);
  const link = await txLink(deps, txHash);
  const rule = audited
    ? "El auditor la revisó y entró en las reglas de pago automático."
    : "Entró en las reglas de pago automático.";
  await deps.notify(
    inv.uploaderPersonId,
    `Listo, pagué la ${what}, de la partida ${line?.name ?? "elegida"}. ${rule}\nVer movimiento: ${link}`,
  );
  const uploader = await personById(deps.db, inv.uploaderPersonId);
  const extra = audited && inv.paymentId !== null ? `\nInforme del auditor: ${urls.audit(deps.appUrl, inv.paymentId, deps.cooperadoraId)}` : "";
  await notifyReviewers(
    deps,
    `Pago automático${audited ? " (revisado por el auditor)" : ""}: ${what}, partida ${line?.name ?? "-"}. La cargó ${uploader?.name ?? "la comisión"}.\nVer movimiento: ${link}${extra}`,
    [[{ text: "Ver la factura", url: inv.fileUrl.startsWith("http") ? inv.fileUrl : urls.panel(deps.appUrl) }]],
  );
}

/** Sends a pending invoice to the signers and tells the uploader why. `note` is the auditor's part. */
async function toSignatures(deps: AgentDeps, inv: InvoiceRow, audit?: { note: string; uploaderText?: string }) {
  const line = await lineOf(deps, inv.lineId);
  const what = await describe(deps, inv);
  await requestSignatures(deps, inv, what, line?.name ?? "-", audit?.note);
  await deps.notify(
    inv.uploaderPersonId,
    audit?.uploaderText ??
      `La ${what} no entra en las reglas de pago automático (tope por pago, saldo de la partida o tope mensual del proveedor), así que necesita firmas. Ya les mandé el pedido a los firmantes y te aviso cuando se pague.`,
  );
}

/** Hash of the auditor's transaction for a payment, if this database saw it go out. */
async function auditTxHash(deps: AgentDeps, paymentId: bigint): Promise<string | null> {
  const [row] = await deps.db.select({ txHash: agentTxs.txHash }).from(agentTxs).where(eq(agentTxs.key, `audit:payment:${paymentId}`));
  return row?.txHash ?? null;
}

/** The auditor's observaciones on a payment, as bullet lines, from its own report. */
async function auditObservations(deps: AgentDeps, paymentId: bigint): Promise<string> {
  const [row] = await deps.db.select({ findings: audits.findings }).from(audits).where(eq(audits.paymentId, paymentId));
  const findings = ((row?.findings as { level: string; text: string }[] | undefined) ?? []).filter((f) => f.level === "observacion");
  return findings.length > 0 ? findings.map((f) => `• ${f.text}`).join("\n") : "• Ver el informe del auditor.";
}

type AuditedState = { status: PaymentStatus; audit: AuditStatus; txHash: string | null };

/**
 * Moves an `auditando` invoice along with what the contract says: paid by the clearance, sent to
 * the signers (cleared but over the limits, or flagged), cancelled, or still waiting.
 */
export async function advanceAudited(deps: AgentDeps, inv: InvoiceRow, state: AuditedState): Promise<InvoiceOutcome> {
  if (state.status === "executed") {
    const row = await transition(deps, inv.id, ["auditando"], { status: "pagada" });
    if (row) await announceAutoPaid(deps, row, state.txHash, true);
    return { invoiceId: inv.id, status: "pagada" };
  }
  if (state.status === "rejected") {
    const row = await transition(deps, inv.id, ["auditando"], { status: "cancelada", statusReason: "rechazada por los firmantes" });
    if (row) await deps.notify(inv.uploaderPersonId, `Los firmantes rechazaron el pago de la ${await describe(deps, inv)}. No se pagó.`);
    return { invoiceId: inv.id, status: "cancelada" };
  }
  if (state.audit === "cleared") {
    const row = await transition(deps, inv.id, ["auditando"], { status: "pendiente" });
    if (row) await toSignatures(deps, row, { note: "El auditor la revisó y no encontró problemas." });
    return { invoiceId: inv.id, status: "pendiente" };
  }
  if (state.audit === "flagged") {
    const row = await transition(deps, inv.id, ["auditando"], { status: "pendiente", statusReason: "observada por el auditor" });
    if (row && inv.paymentId !== null) {
      const observations = await auditObservations(deps, inv.paymentId);
      const report = urls.audit(deps.appUrl, inv.paymentId, deps.cooperadoraId);
      await toSignatures(deps, row, {
        note: `El auditor la observó y no la dejó salir automática:\n${observations}\nInforme: ${report}`,
        uploaderText:
          `El auditor observó la ${await describe(deps, inv)}:\n${observations}\n` +
          `No la pago sola: se la mandé a los firmantes para que decidan. Te aviso cuando la firmen o la rechacen.`,
      });
    }
    return { invoiceId: inv.id, status: "pendiente" };
  }
  // Not reviewed yet. After a while it goes to the signers anyway, and the operator hears about it.
  if (deps.now().getTime() - inv.updatedAt.getTime() < AUDIT_TIMEOUT_MS) return { invoiceId: inv.id, status: "auditando" };
  const row = await transition(deps, inv.id, ["auditando"], { status: "pendiente", statusReason: "el auditor no respondió" });
  if (row) {
    await toSignatures(deps, row, { note: "El auditor todavía no la revisó, así que no puede salir automática." });
    const text = `Atención operador: el auditor no revisó el pago #${inv.paymentId} en ${AUDIT_TIMEOUT_MS / 60_000} minutos. Lo mandé a firmas. Revisá que /api/auditor esté corriendo.`;
    console.error(text);
    for (const op of await personsWithRoles(deps.db, [OPERATOR_ROLE])) await notifyOnce(deps, op.id, `audit-timeout:${inv.paymentId}`, text);
  }
  return { invoiceId: inv.id, status: "pendiente" };
}

async function requestSignatures(deps: AgentDeps, inv: InvoiceRow, what: string, lineName: string, note?: string) {
  const uploader = await personById(deps.db, inv.uploaderPersonId);
  const summary =
    `Hay un pago que necesita tu firma:\n${what}\nPartida: ${lineName}\nLa cargó: ${uploader?.name ?? "la comisión"}` +
    (note ? `\n\n${note}` : "");
  for (const signer of await personsWithRoles(deps.db, SIGNER_ROLES)) {
    if (signer.safeAddress && inv.paymentId !== null) {
      const url = await paymentSignUrl(deps.db, deps.appUrl, signer.id, inv.paymentId, deps.now());
      await deps.notify(
        signer.id,
        `${summary}\n\nAbrí el link en Chrome o Safari (no dentro de Telegram) para firmar con tu huella o tu cara. Vence en 24 horas.`,
        [[{ text: "Revisar y firmar", url }]],
      );
    } else {
      await notifySignerWithoutPasskey(deps, signer, summary);
    }
  }
}

export async function notifySignerWithoutPasskey(deps: AgentDeps, signer: Person, summary: string) {
  const url = await enrollUrl(deps.db, deps.appUrl, signer.id, deps.now());
  await deps.notify(
    signer.id,
    `${summary}\n\nPara poder firmar, primero creá tu firma con la huella o la cara del teléfono. Abrí el link en Chrome o Safari.`,
    [[{ text: "Crear mi firma", url }]],
  );
}

/** Threshold from the last SignersSet the indexer saw (the constructor emits one). */
async function currentThreshold(deps: AgentDeps): Promise<number | null> {
  const [ev] = await deps.db
    .select({ args: chainEvents.args })
    .from(chainEvents)
    .where(eq(chainEvents.eventName, "SignersSet"))
    .orderBy(desc(chainEvents.blockNumber), desc(chainEvents.logIndex))
    .limit(1);
  const t = Number((ev?.args as { threshold?: unknown } | undefined)?.threshold);
  return Number.isFinite(t) && t > 0 ? t : null;
}

/**
 * Step 6 (tick): retries invoices left in `propuesta` and moves pending ones along with the
 * indexed payment: executed → pagada, rejected → cancelada, enough approvals → aprobada.
 */
export async function syncInvoices(deps: AgentDeps): Promise<{ retried: number; paid: number; cancelled: number; approved: number }> {
  const out = { retried: 0, paid: 0, cancelled: 0, approved: 0 };
  for (const inv of await deps.db.select().from(invoices).where(eq(invoices.status, "propuesta")).orderBy(invoices.id)) {
    out.retried++;
    await proposeInvoice(deps, inv);
  }

  // Waiting for the auditor: the index has its verdict as soon as it has the event.
  const auditing = await deps.db
    .select({ inv: invoices, pay: payments })
    .from(invoices)
    .leftJoin(payments, eq(payments.paymentId, invoices.paymentId))
    .where(eq(invoices.status, "auditando"))
    .orderBy(invoices.id);
  for (const { inv, pay } of auditing) {
    const r = await advanceAudited(deps, inv, {
      status: (pay?.status as PaymentStatus | undefined) ?? "pending",
      audit: (pay?.audit as AuditStatus | null | undefined) ?? "none",
      txHash: pay?.executedTxHash ?? null,
    });
    if (r.status === "pagada") out.paid++;
    if (r.status === "cancelada") out.cancelled++;
  }

  const waiting = await deps.db
    .select({ inv: invoices, pay: payments })
    .from(invoices)
    .innerJoin(payments, eq(payments.paymentId, invoices.paymentId))
    .where(inArray(invoices.status, ["pendiente", "aprobada"]))
    .orderBy(invoices.id);
  let threshold: number | null | undefined;

  for (const { inv, pay } of waiting) {
    const what = await describe(deps, inv);
    if (pay.status === "executed") {
      if (!(await transition(deps, inv.id, ["pendiente", "aprobada"], { status: "pagada" }))) continue;
      out.paid++;
      const link = await txLink(deps, pay.executedTxHash);
      // A late clearance from the auditor can still pay it automatically, before anyone signs.
      if (pay.rule === "auto") {
        const text = `Ya se pagó la ${what}: el auditor la aprobó y entró en las reglas de pago automático, así que no hizo falta firmar.\nVer movimiento: ${link}`;
        await deps.notify(inv.uploaderPersonId, text);
        for (const s of await personsWithRoles(deps.db, SIGNER_ROLES)) {
          if (s.id !== inv.uploaderPersonId) await deps.notify(s.id, text);
        }
        continue;
      }
      const text = `Ya se pagó la ${what}, con las firmas de la comisión. ¡Gracias por firmar!\nVer movimiento: ${link}`;
      await deps.notify(inv.uploaderPersonId, `Ya se pagó la ${what}. Juntó las firmas necesarias.\nVer movimiento: ${link}`);
      for (const s of await personsWithRoles(deps.db, SIGNER_ROLES)) {
        if (s.id !== inv.uploaderPersonId) await deps.notify(s.id, text);
      }
    } else if (pay.status === "rejected") {
      if (!(await transition(deps, inv.id, ["pendiente", "aprobada"], { status: "cancelada", statusReason: "rechazada por los firmantes" }))) continue;
      out.cancelled++;
      const text = `Los firmantes rechazaron el pago de la ${what}. No se pagó.`;
      await deps.notify(inv.uploaderPersonId, text);
      for (const s of await personsWithRoles(deps.db, SIGNER_ROLES)) {
        if (s.id !== inv.uploaderPersonId) await deps.notify(s.id, text);
      }
    } else if (inv.status === "pendiente" && pay.approvals > 0) {
      threshold ??= await currentThreshold(deps);
      if (threshold === null || pay.approvals < threshold) continue;
      if (!(await transition(deps, inv.id, ["pendiente"], { status: "aprobada" }))) continue;
      out.approved++;
      await deps.notify(
        inv.uploaderPersonId,
        `La ${what} ya tiene todas las firmas. El pago sale apenas el tesoro lo permita (por ejemplo, si está en pausa o le falta saldo).`,
      );
    }
  }
  return out;
}

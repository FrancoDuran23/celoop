// Resolving invoices in `revision`. A revisor or the presidente (never the uploader) looks at the
// reason and the data read, and either lets it continue or rejects it. "Seguir" does not skip the
// fixed rules: the invoice is validated again with the same code as any other upload, so a person
// can only clear the soft flags (injection text, QR/AI mismatch, a refused send), never pay
// something made out to someone else, from a vendor that isn't enabled, or twice.
import { and, eq, ne } from "drizzle-orm";
import type { Hex } from "viem";
import { cooperadora, invoices, vendors } from "@/db/schema";
import { invoiceIdOf, validateInvoice, type InvoiceFields } from "@/lib/invoice";
import type { AgentDeps } from "./deps";
import { arDate } from "./format";
import { scopeId } from "@/lib/tenant";
import { askForLine, describe, type InvoiceRow } from "./invoice";
import { personInCooperadora, type Person } from "./people";
import { canReviewInvoices, hasFiscalData, reviewCard } from "./review-card";

export { canReviewInvoices } from "./review-card";

export type ReviewRecord = { decision: "seguir" | "rechazar"; personId: number; name: string; at: string };

/** "Facturas para revisar": one card per invoice this person may resolve. */
export async function listForReview(deps: AgentDeps, person: Person): Promise<number> {
  if (!canReviewInvoices(person)) {
    await deps.notify(person.id, "Esa opción no está disponible para vos.");
    return 0;
  }
  const rows = await deps.db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.cooperadoraId, scopeId(deps.cooperadoraId)),
        eq(invoices.status, "revision"),
        ne(invoices.uploaderPersonId, person.id),
      ),
    )
    .orderBy(invoices.id)
    .limit(10);
  if (rows.length === 0) {
    await deps.notify(person.id, "No hay facturas para revisar.");
    return 0;
  }
  for (const inv of rows) {
    const card = await reviewCard(deps.db, inv);
    await deps.notify(person.id, card.text, card.buttons);
  }
  return rows.length;
}

/** Fields as validateInvoice takes them, rebuilt from the stored row. */
function fieldsOf(inv: InvoiceRow): InvoiceFields {
  const raw = (inv.extracted ?? {}) as { qr?: { moneda?: unknown }; llm?: { moneda?: unknown } };
  const moneda = raw.qr?.moneda ?? raw.llm?.moneda;
  return {
    cuit: inv.cuit!,
    tipo: inv.tipo!,
    ptoVta: inv.ptoVta!,
    nro: inv.nro!,
    importe: inv.amountPesos!,
    fecha: inv.issuedOn!,
    moneda: typeof moneda === "string" ? moneda : "PES",
    receptorDocTipo: inv.receptorDocTipo,
    receptorDocNro: inv.receptorDocNro,
    cae: inv.cae,
  };
}

const withReview = (inv: InvoiceRow, review: ReviewRecord) => ({
  ...((inv.extracted ?? {}) as Record<string, unknown>),
  review,
});

export type ReviewOutcome = { status: string; error?: string };

export async function resolveReview(
  deps: AgentDeps,
  args: { personId: number; invoiceRowId: number; decision: "seguir" | "rechazar" },
): Promise<ReviewOutcome> {
  const { db } = deps;
  const coopId = scopeId(deps.cooperadoraId);
  const [inv] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, args.invoiceRowId), eq(invoices.cooperadoraId, coopId)));
  // Roles count in the invoice's own cooperative only.
  const person = await personInCooperadora(db, args.personId, coopId);
  if (!person) return { status: inv?.status ?? "desconocida", error: "unknown_person" };
  if (!inv || !canReviewInvoices(person) || inv.uploaderPersonId === person.id) {
    await deps.notify(person.id, "Esa factura no la podés resolver vos: la tiene que revisar otra persona.");
    return { status: inv?.status ?? "desconocida", error: "not_allowed" };
  }
  if (inv.status !== "revision") {
    await deps.notify(person.id, "Esa factura ya no está en revisión: la resolvió otra persona.");
    return { status: inv.status, error: "not_in_review" };
  }
  const review: ReviewRecord = { decision: args.decision, personId: person.id, name: person.name, at: deps.now().toISOString() };
  const what = await describe(deps, inv);

  if (args.decision === "rechazar") {
    const reason = `${inv.statusReason ?? "en revisión"}. La rechazó ${person.name} en la revisión`;
    const [row] = await db
      .update(invoices)
      .set({ status: "rechazada", statusReason: reason, extracted: withReview(inv, review), updatedAt: deps.now() })
      .where(and(eq(invoices.id, inv.id), eq(invoices.status, "revision")))
      .returning();
    if (!row) {
      await deps.notify(person.id, "Esa factura ya no está en revisión: la resolvió otra persona.");
      return { status: "resuelta", error: "not_in_review" };
    }
    await deps.notify(
      inv.uploaderPersonId,
      `${person.name} revisó la ${what} y la rechazó, así que no se paga. Motivo de la revisión: ${inv.statusReason ?? "-"}.`,
    );
    await deps.notify(person.id, `Listo, la ${what} quedó rechazada. Ya le avisé a quien la cargó.`);
    return { status: "rechazada" };
  }

  // "Está bien, seguir"
  if (!hasFiscalData(inv)) {
    await deps.notify(person.id, "Esta factura no tiene los datos fiscales leídos, así que no puede seguir. Si corresponde, rechazala.");
    return { status: "revision", error: "no_fiscal_data" };
  }
  const f = fieldsOf(inv);
  const [coop] = await db.select().from(cooperadora).where(eq(cooperadora.id, inv.cooperadoraId));
  if (!coop) throw new Error(`cooperadora ${inv.cooperadoraId} is not configured`);
  const enabled = await db
    .select()
    .from(vendors)
    .where(and(eq(vendors.cooperadoraId, inv.cooperadoraId), eq(vendors.enabled, true)));
  const invoiceId = invoiceIdOf(f);
  const validation = await validateInvoice(f, {
    cooperadoraCuit: coop.cuit,
    enabledVendorCuits: new Set(enabled.map((v) => v.cuit)),
    alreadyPaid: async () => {
      const [other] = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.cooperadoraId, inv.cooperadoraId), eq(invoices.invoiceId, invoiceId), ne(invoices.id, inv.id)));
      return !!other || (await deps.chain.isInvoicePaid(invoiceId as Hex));
    },
    today: arDate(deps.now()),
  });
  if (!validation.ok) {
    await deps.notify(
      person.id,
      `La ${what} no puede seguir aunque la revisión esté bien: ${validation.reason}. Si corresponde, rechazala.`,
    );
    return { status: "revision", error: validation.code };
  }
  const vendor = enabled.find((v) => v.cuit === f.cuit)!;
  let row: InvoiceRow | undefined;
  try {
    [row] = await db
      .update(invoices)
      .set({
        status: "validada",
        statusReason: null,
        invoiceId,
        vendorId: vendor.id,
        lineId: null,
        paymentId: null,
        extracted: withReview(inv, review),
        updatedAt: deps.now(),
      })
      .where(and(eq(invoices.id, inv.id), eq(invoices.status, "revision")))
      .returning();
  } catch {
    await deps.notify(person.id, `La ${what} ya está cargada en otra fila, así que no puede seguir. Rechazala.`);
    return { status: "revision", error: "duplicate" };
  }
  if (!row) {
    await deps.notify(person.id, "Esa factura ya no está en revisión: la resolvió otra persona.");
    return { status: "resuelta", error: "not_in_review" };
  }
  await deps.notify(inv.uploaderPersonId, `${person.name} revisó la ${what} y está bien, así que sigue.`);
  await askForLine(deps, row);
  await deps.notify(person.id, `Listo. Le pedí a quien cargó la ${what} que elija la partida.`);
  return { status: "validada" };
}

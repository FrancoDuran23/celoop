// The card a reviewer sees for an invoice in `revision`: reason, file and the data read.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { invoices, persons, vendors } from "@/db/schema";
import type { InlineButton } from "@/lib/bot/notify";
import { formatCuit, formatDate } from "@/lib/report/format";
import type { AgentDeps } from "./deps";
import { formatPesos, invoiceLabel } from "./format";
import { personsWithRoles } from "./people";

type InvoiceRow = typeof invoices.$inferSelect;

/** Roles that can resolve an invoice in review (never the person who uploaded it). */
export const INVOICE_REVIEW_ROLES = ["revisor", "presidente"] as const;

export const canReviewInvoices = (p: { roles: string[] }) => p.roles.some((r) => (INVOICE_REVIEW_ROLES as readonly string[]).includes(r));

/** Enough fiscal data to validate and pay: without it the only way out is rejecting. */
export const hasFiscalData = (inv: InvoiceRow) =>
  inv.cuit !== null && inv.tipo !== null && inv.ptoVta !== null && inv.nro !== null && !!inv.amountPesos && !!inv.issuedOn && !!inv.amount;

export async function reviewCard(db: Db, inv: InvoiceRow): Promise<{ text: string; buttons: InlineButton[][] }> {
  const [uploader] = await db.select({ name: persons.name }).from(persons).where(eq(persons.id, inv.uploaderPersonId));
  const lines = [
    `Hay una factura para revisar (#${inv.id}, la cargó ${uploader?.name ?? "la comisión"} el ${formatDate(inv.createdAt)}).`,
    `Motivo: ${inv.statusReason ?? "sin motivo registrado"}.`,
  ];
  if (hasFiscalData(inv)) {
    const [v] = await db
      .select({ name: vendors.legalName })
      .from(vendors)
      .where(and(eq(vendors.cooperadoraId, inv.cooperadoraId), eq(vendors.cuit, inv.cuit!)));
    lines.push(
      "",
      "Datos leídos:",
      `• ${invoiceLabel(inv)}`,
      `• Emisor: ${v?.name ? `${v.name}, ` : ""}CUIT ${formatCuit(inv.cuit)}`,
      `• Fecha: ${inv.issuedOn}`,
      `• Importe: ${formatPesos(inv.amount)}`,
      `• Receptor: ${inv.receptorDocNro !== null ? `CUIT ${formatCuit(inv.receptorDocNro)}` : "no figura"}`,
    );
  } else {
    lines.push("", "No se pudieron leer los datos fiscales, así que solo se puede rechazar.");
  }
  const buttons: InlineButton[][] = [];
  if (inv.fileUrl.startsWith("http")) buttons.push([{ text: "Ver la factura", url: inv.fileUrl }]);
  const row: InlineButton[] = [];
  if (hasFiscalData(inv)) row.push({ text: "Está bien, seguir", data: `rev:ok:${inv.id}` });
  row.push({ text: "Rechazar", data: `rev:no:${inv.id}` });
  buttons.push(row);
  return { text: lines.join("\n"), buttons };
}

/** Sends the card to every revisor and presidente of the invoice's cooperative, except the uploader. */
export async function sendReviewCards(deps: Pick<AgentDeps, "db" | "notify">, inv: InvoiceRow): Promise<void> {
  const card = await reviewCard(deps.db, inv);
  const reviewers = await personsWithRoles(deps.db, INVOICE_REVIEW_ROLES, inv.cooperadoraId);
  for (const r of reviewers) if (r.id !== inv.uploaderPersonId) await deps.notify(r.id, card.text, card.buttons);
}

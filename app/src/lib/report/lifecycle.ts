// Report lifecycle: borrador → revisada → publicada.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { scopeId } from "@/lib/tenant";
import { reports, signLinks } from "@/db/schema";
import { buildReport } from "./build";
import { renderReportPdf } from "./pdf";
import { checkReviewToken, type TokenCheck } from "./tokens";
import type { PdfStorage } from "./storage";
import type { ReportData } from "./types";

export type ReportRow = typeof reports.$inferSelect;

export async function getReportRow(db: Db, period: string, cooperadoraId?: number): Promise<ReportRow | null> {
  const [row] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.period, period), eq(reports.cooperadoraId, scopeId(cooperadoraId))));
  return row ?? null;
}

/** Creates the draft for a closed month; recomputes it if it is still a draft. */
export async function closeReport(db: Db, period: string, cooperadoraId?: number): Promise<{ row: ReportRow; created: boolean }> {
  const existing = await getReportRow(db, period, cooperadoraId);
  const data = await buildReport(db, period, cooperadoraId);
  if (!existing) {
    const [row] = await db
      .insert(reports)
      .values({ period, status: "borrador", data, cooperadoraId: scopeId(cooperadoraId) })
      .returning();
    return { row, created: true };
  }
  if (existing.status !== "borrador") return { row: existing, created: false };
  const [row] = await db
    .update(reports)
    .set({ data })
    .where(eq(reports.id, existing.id))
    .returning();
  return { row, created: false };
}

export type ReviewResult =
  | { ok: true; row: ReportRow }
  | { ok: false; error: "not_found" | "bad_state" | "bad_token"; token?: TokenCheck };

/** The reviewer confirms with their link: borrador → revisada. */
/** The cooperative is the one the reviewer's link was made for (or `cooperadoraId`, which must match). */
export async function reviewReport(db: Db, period: string, token: string | null | undefined, now = new Date(), cooperadoraId?: number): Promise<ReviewResult> {
  const check = await checkReviewToken(db, token, period, now, cooperadoraId);
  const row = await getReportRow(db, period, check.ok ? check.cooperadoraId : cooperadoraId);
  if (!row) return { ok: false, error: "not_found" };
  if (!check.ok) return { ok: false, error: "bad_token", token: check };
  if (check.used || row.status !== "borrador") return { ok: false, error: "bad_state" };
  const [updated] = await db
    .update(reports)
    .set({ status: "revisada", reviewedByPersonId: check.personId, reviewedAt: now })
    .where(and(eq(reports.id, row.id)))
    .returning();
  await db.update(signLinks).set({ usedAt: now }).where(eq(signLinks.token, token!));
  return { ok: true, row: updated };
}

/** revisada → publicada: renders the PDF and stores it. */
export async function publishReport(
  db: Db, period: string, store: PdfStorage, now = new Date(), cooperadoraId?: number,
): Promise<{ ok: true; row: ReportRow } | { ok: false; error: "not_found" | "bad_state" }> {
  const row = await getReportRow(db, period, cooperadoraId);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "revisada") return { ok: false, error: "bad_state" };
  const bytes = await renderReportPdf(row.data as ReportData);
  const pdfUrl = await store(period, bytes, row.cooperadoraId);
  const [updated] = await db
    .update(reports)
    .set({ status: "publicada", pdfUrl, publishedAt: now })
    .where(eq(reports.id, row.id))
    .returning();
  return { ok: true, row: updated };
}

/** A published report is public; anything earlier needs the reviewer's token. */
export async function canView(db: Db, row: ReportRow, token: string | null | undefined, now = new Date()): Promise<boolean> {
  if (row.status === "publicada") return true;
  return (await checkReviewToken(db, token, row.period, now, row.cooperadoraId)).ok;
}

// Report lifecycle: borrador → revisada → publicada.
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { reports, signLinks } from "@/db/schema";
import { buildReport } from "./build";
import { renderReportPdf } from "./pdf";
import { checkReviewToken, type TokenCheck } from "./tokens";
import type { PdfStorage } from "./storage";
import type { ReportData } from "./types";

export type ReportRow = typeof reports.$inferSelect;

export async function getReportRow(db: Db, period: string): Promise<ReportRow | null> {
  const [row] = await db.select().from(reports).where(eq(reports.period, period));
  return row ?? null;
}

/** Creates the draft for a closed month; recomputes it if it is still a draft. */
export async function closeReport(db: Db, period: string): Promise<{ row: ReportRow; created: boolean }> {
  const existing = await getReportRow(db, period);
  const data = await buildReport(db, period);
  if (!existing) {
    const [row] = await db.insert(reports).values({ period, status: "borrador", data }).returning();
    return { row, created: true };
  }
  if (existing.status !== "borrador") return { row: existing, created: false };
  const [row] = await db.update(reports).set({ data }).where(eq(reports.period, period)).returning();
  return { row, created: false };
}

export type ReviewResult =
  | { ok: true; row: ReportRow }
  | { ok: false; error: "not_found" | "bad_state" | "bad_token"; token?: TokenCheck };

/** The reviewer confirms with their link: borrador → revisada. */
export async function reviewReport(db: Db, period: string, token: string | null | undefined, now = new Date()): Promise<ReviewResult> {
  const row = await getReportRow(db, period);
  if (!row) return { ok: false, error: "not_found" };
  const check = await checkReviewToken(db, token, period, now);
  if (!check.ok) return { ok: false, error: "bad_token", token: check };
  if (check.used || row.status !== "borrador") return { ok: false, error: "bad_state" };
  const [updated] = await db
    .update(reports)
    .set({ status: "revisada", reviewedByPersonId: check.personId, reviewedAt: now })
    .where(eq(reports.period, period))
    .returning();
  await db.update(signLinks).set({ usedAt: now }).where(eq(signLinks.token, token!));
  return { ok: true, row: updated };
}

/** revisada → publicada: renders the PDF and stores it. */
export async function publishReport(
  db: Db, period: string, store: PdfStorage, now = new Date(),
): Promise<{ ok: true; row: ReportRow } | { ok: false; error: "not_found" | "bad_state" }> {
  const row = await getReportRow(db, period);
  if (!row) return { ok: false, error: "not_found" };
  if (row.status !== "revisada") return { ok: false, error: "bad_state" };
  const bytes = await renderReportPdf(row.data as ReportData);
  const pdfUrl = await store(period, bytes);
  const [updated] = await db
    .update(reports)
    .set({ status: "publicada", pdfUrl, publishedAt: now })
    .where(eq(reports.period, period))
    .returning();
  return { ok: true, row: updated };
}

/** A published report is public; anything earlier needs the reviewer's token. */
export async function canView(db: Db, row: ReportRow, token: string | null | undefined, now = new Date()): Promise<boolean> {
  if (row.status === "publicada") return true;
  return (await checkReviewToken(db, token, row.period, now)).ok;
}

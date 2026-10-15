import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db";
import { canView, closeReport, publishReport, reviewReport } from "./lifecycle";
import { REVIEW_TOKEN, seedReportData } from "./test-seed";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await seedReportData(db);
});

test("borrador -> revisada -> publicada", async () => {
  const { row, created } = await closeReport(db, "2026-10");
  expect(created).toBe(true);
  expect(row.status).toBe("borrador");
  expect((await closeReport(db, "2026-10")).created).toBe(false);

  expect(await canView(db, row, null)).toBe(false);
  expect(await canView(db, row, REVIEW_TOKEN)).toBe(true);

  const bad = await reviewReport(db, "2026-10", "nope");
  expect(bad).toMatchObject({ ok: false, error: "bad_token" });
  const reviewed = await reviewReport(db, "2026-10", REVIEW_TOKEN);
  expect(reviewed.ok && reviewed.row.status).toBe("revisada");
  expect(await reviewReport(db, "2026-10", REVIEW_TOKEN)).toMatchObject({ ok: false });

  const stored: string[] = [];
  const published = await publishReport(db, "2026-10", async (p, bytes) => {
    stored.push(p);
    expect(bytes.byteLength).toBeGreaterThan(0);
    return "https://blob.example/x.pdf";
  });
  expect(published.ok && published.row).toMatchObject({ status: "publicada", pdfUrl: "https://blob.example/x.pdf" });
  expect(stored).toEqual(["2026-10"]);
  if (published.ok) expect(await canView(db, published.row, null)).toBe(true);
});

test("cannot publish a draft or review a missing report", async () => {
  expect(await reviewReport(db, "2026-09", REVIEW_TOKEN)).toMatchObject({ error: "not_found" });
  await closeReport(db, "2026-10");
  expect(await publishReport(db, "2026-10", async () => "x")).toMatchObject({ ok: false, error: "bad_state" });
});

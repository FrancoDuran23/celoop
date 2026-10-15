import { beforeEach, expect, test, vi } from "vitest";
import type { Db } from "@/db";
import { createTestDb } from "@/db/testing";
import { closeReport, publishReport, reviewReport } from "@/lib/report/lifecycle";
import { REVIEW_TOKEN, seedReportData } from "@/lib/report/test-seed";

let db: Db;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => db }));
const { GET } = await import("./[period]/pdf/route");

const get = (period: string, token?: string) =>
  GET(new Request(`http://localhost/rendicion/${period}/pdf${token ? `?token=${token}` : ""}`), {
    params: Promise.resolve({ period }),
  });

beforeEach(async () => {
  db = await createTestDb();
  await seedReportData(db);
  await closeReport(db, "2026-10");
});

test("a draft PDF is hidden without the reviewer token", async () => {
  expect((await get("2026-10")).status).toBe(404);
  const res = await get("2026-10", REVIEW_TOKEN);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/pdf");
  expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
});

test("a published report downloads without a token", async () => {
  await reviewReport(db, "2026-10", REVIEW_TOKEN);
  await publishReport(db, "2026-10", async () => "local:file");
  const res = await get("2026-10");
  expect(res.status).toBe(200);
  expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 4))).toBe("%PDF");
});

test("unknown or invalid periods are 404", async () => {
  expect((await get("2026-09")).status).toBe(404);
  expect((await get("nope")).status).toBe(404);
});

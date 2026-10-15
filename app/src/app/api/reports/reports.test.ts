import { beforeEach, expect, test, vi } from "vitest";
import type { Db } from "@/db";
import { createTestDb } from "@/db/testing";
import { resetEnv } from "@/lib/env";
import { REVIEW_TOKEN, seedReportData } from "@/lib/report/test-seed";

let db: Db;
vi.mock("@/db", async (orig) => ({ ...(await orig<typeof import("@/db")>()), getDb: () => db }));
vi.mock("@/lib/report/storage", () => ({ storePdf: async (p: string) => `https://blob.example/${p}.pdf` }));

const { POST: close } = await import("./close/route");
const { POST: review } = await import("./[period]/review/route");
const { POST: publish } = await import("./[period]/publish/route");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers });
const ctx = (period: string) => ({ params: Promise.resolve({ period }) });
const auth = { authorization: "Bearer s3cret" };

beforeEach(async () => {
  resetEnv({ TICK_SECRET: "s3cret" });
  db = await createTestDb();
  await seedReportData(db);
});

test("close needs the tick secret", async () => {
  expect((await close(post({ period: "2026-10" }))).status).toBe(401);
  expect((await close(post({ period: "2026-10" }, { authorization: "Bearer nope" }))).status).toBe(401);
});

test("close, review and publish walk the lifecycle", async () => {
  const closed = await close(post({ period: "2026-10" }, auth));
  expect(await closed.json()).toMatchObject({ status: "borrador", created: true });

  expect((await review(post({ token: "bad" }), ctx("2026-10"))).status).toBe(401);
  expect((await publish(post({}, auth), ctx("2026-10"))).status).toBe(409); // still a draft

  const reviewed = await review(post({ token: REVIEW_TOKEN }), ctx("2026-10"));
  expect(await reviewed.json()).toMatchObject({ status: "revisada" });

  const published = await publish(post({}, auth), ctx("2026-10"));
  expect(await published.json()).toMatchObject({ status: "publicada", pdfUrl: "https://blob.example/2026-10.pdf" });
});

test("rejects a malformed period", async () => {
  expect((await close(post({ period: "octubre" }, auth))).status).toBe(400);
});

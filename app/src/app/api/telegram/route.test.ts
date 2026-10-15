import { eq } from "drizzle-orm";
import { beforeEach, expect, test, vi } from "vitest";
import type { Bot } from "grammy";
import { persons } from "@/db/schema";
import { resetEnv } from "@/lib/env";
import { testAgent } from "@/lib/orchestrator/testing";
import { testBot, updates } from "@/lib/bot/testing";

const tasks: Promise<void>[] = [];
let bot: Bot;
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void tasks.push(fn()) }));
vi.mock("@/lib/bot/instance", () => ({ getBot: async () => bot }));

const { POST } = await import("./route");

const post = (body: unknown, secret?: string) =>
  new Request("http://localhost/api/telegram", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...(secret ? { "x-telegram-bot-api-secret-token": secret } : {}) },
  });

let t: Awaited<ReturnType<typeof testAgent>>;
beforeEach(async () => {
  resetEnv({ TELEGRAM_WEBHOOK_SECRET: "hook-secret" });
  tasks.splice(0);
  t = await testAgent();
  bot = testBot(t.deps).bot;
});

test("an update with a wrong or missing secret is refused with 401", async () => {
  const update = updates.text(1001, "/start");
  expect((await POST(post(update))).status).toBe(401);
  expect((await POST(post(update, "nope"))).status).toBe(401);
  expect(tasks).toHaveLength(0);
});

test("a request_contact from a known phone links the person", async () => {
  await t.db.update(persons).set({ telegramUserId: null, telegramChatId: null }).where(eq(persons.id, t.people.socia.id));
  const res = await POST(post(updates.contact(555, "+5493880000001"), "hook-secret"));
  expect(res.status).toBe(200);
  await Promise.all(tasks);
  const [p] = await t.db.select().from(persons).where(eq(persons.id, t.people.socia.id));
  expect(p.telegramUserId).toBe(BigInt(555));
  expect(p.telegramChatId).toBe(BigInt(555));
  expect(t.tg.to(p.id)[0].text).toContain("¡Hola, Marta!");
});

test("a body that isn't an update is a 400", async () => {
  expect((await POST(post({ hello: 1 }, "hook-secret"))).status).toBe(400);
});

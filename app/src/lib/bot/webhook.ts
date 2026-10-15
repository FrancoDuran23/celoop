// Webhook entry: checks Telegram's secret header, answers 200 right away and processes the update
// afterwards (reading an invoice or waiting for a receipt takes longer than Telegram waits).
import { timingSafeEqual } from "node:crypto";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";

export const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleTelegramWebhook(
  request: Request,
  opts: {
    secret: string | undefined;
    getBot: () => Promise<Bot>;
    /** Runs work after the response (next/server `after` in production). */
    schedule: (task: () => Promise<void>) => void;
  },
): Promise<Response> {
  if (!secretMatches(request.headers.get(SECRET_HEADER), opts.secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  let update: Update;
  try {
    update = (await request.json()) as Update;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!update || typeof update.update_id !== "number") {
    return Response.json({ error: "invalid_update" }, { status: 400 });
  }
  opts.schedule(async () => {
    try {
      const bot = await opts.getBot();
      await bot.handleUpdate(update);
    } catch (e) {
      console.error(`telegram update ${update.update_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return Response.json({ ok: true });
}

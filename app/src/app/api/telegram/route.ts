import { after } from "next/server";
import { getBot } from "@/lib/bot/instance";
import { handleTelegramWebhook } from "@/lib/bot/webhook";
import { env } from "@/lib/env";

/** Reading an invoice and waiting for the payment receipt can take a while. */
export const maxDuration = 120;

/** Telegram webhook. Set it with secret_token = TELEGRAM_WEBHOOK_SECRET. */
export async function POST(request: Request) {
  return handleTelegramWebhook(request, {
    secret: env().TELEGRAM_WEBHOOK_SECRET,
    getBot,
    schedule: (task) => after(task),
  });
}

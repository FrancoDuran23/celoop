// Production bot: one per server instance, initialized (getMe) on first use.
import type { Bot } from "grammy";
import { required } from "@/lib/env";
import { productionDeps } from "@/lib/orchestrator/runtime";
import { claudeAssistant } from "./assistant";
import { createBot } from "./bot";

let bot: Promise<Bot> | undefined;

export function getBot(): Promise<Bot> {
  bot ??= (async () => {
    const b = createBot({ token: required("TELEGRAM_BOT_TOKEN"), deps: { ...productionDeps(), assistant: claudeAssistant() } });
    await b.init();
    return b;
  })().catch((e) => {
    bot = undefined;
    throw e;
  });
  return bot;
}

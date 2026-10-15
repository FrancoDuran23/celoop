// Production wiring: Neon, Telegram through grammY's Api, and every default port.
import { Api } from "grammy";
import { getDb } from "@/db";
import { telegramNotifier } from "@/lib/bot/notify";
import { required } from "@/lib/env";
import { defaultAgentDeps, type AgentDeps } from "./deps";

let api: Api | undefined;

export function telegramApi(): Api {
  return (api ??= new Api(required("TELEGRAM_BOT_TOKEN")));
}

export function productionDeps(): AgentDeps {
  const db = getDb();
  return defaultAgentDeps({ db, notify: telegramNotifier(db, telegramApi()) });
}

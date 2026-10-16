// Production wiring: Neon, Telegram through grammY's Api, and every default port.
import { Api } from "grammy";
import { getDb } from "@/db";
import { defaultAuditorDeps, type AuditorDeps } from "@/lib/auditor/deps";
import { telegramNotifier } from "@/lib/bot/notify";
import { env, required } from "@/lib/env";
import { chainPort, defaultAgentDeps, type AgentDeps } from "./deps";

let api: Api | undefined;

export function telegramApi(): Api {
  return (api ??= new Api(required("TELEGRAM_BOT_TOKEN")));
}

/** The auditor's own wiring: its key (AUDITOR_PRIVATE_KEY), the QR reader only, no LLM. */
export function productionAuditorDeps(): AuditorDeps {
  const db = getDb();
  return defaultAuditorDeps({ db, notify: telegramNotifier(db, telegramApi()) });
}

export function productionDeps(): AgentDeps {
  const db = getDb();
  const deps = defaultAgentDeps({
    db,
    notify: telegramNotifier(db, telegramApi()),
    // The treasurer only asks the auditor to hurry; the auditor decides with its own deps and key.
    auditNow: env().AUDITOR_PRIVATE_KEY
      ? async () => (await import("@/lib/auditor")).runAuditor(productionAuditorDeps())
      : undefined,
  });
  return {
    ...deps,
    chainFor: (scope) => chainPort({ db, ...scope }),
  };
}

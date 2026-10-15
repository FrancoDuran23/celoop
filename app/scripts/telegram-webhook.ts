// Registers the Telegram webhook: APP_URL/api/telegram with secret_token = TELEGRAM_WEBHOOK_SECRET.
//
//   npx tsx scripts/telegram-webhook.ts [--drop-pending]
//
// Reads TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and APP_URL (https) from the environment or app/.env.
import "dotenv/config";
import { parseArgs } from "./lib/guard";
import { setTelegramWebhook } from "./lib/telegram-webhook";

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const { url, info } = await setTelegramWebhook({
    token: process.env.TELEGRAM_BOT_TOKEN,
    secret: process.env.TELEGRAM_WEBHOOK_SECRET,
    appUrl: process.env.APP_URL,
    dropPendingUpdates: flags.has("drop-pending"),
  });
  console.log(`Webhook registrado: ${url}`);
  console.log(`Updates pendientes: ${String(info.pending_update_count ?? 0)}`);
  if (info.last_error_message) console.log(`Último error que vio Telegram: ${String(info.last_error_message)}`);
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

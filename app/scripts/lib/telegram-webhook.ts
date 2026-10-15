// Points the Telegram bot at /api/telegram with secret_token = TELEGRAM_WEBHOOK_SECRET, which the
// route checks on every update (x-telegram-bot-api-secret-token).

export const ALLOWED_UPDATES = ["message", "callback_query"] as const;

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  json(): Promise<unknown>;
}>;

export type WebhookOptions = {
  token: string | undefined;
  secret: string | undefined;
  appUrl: string | undefined;
  dropPendingUpdates?: boolean;
  fetchImpl?: Fetch;
  apiRoot?: string;
};

export function webhookUrl(appUrl: string): string {
  const url = new URL(`${appUrl.replace(/\/+$/, "")}/api/telegram`);
  if (url.protocol !== "https:") throw new Error(`Telegram solo acepta webhooks HTTPS (APP_URL=${appUrl}).`);
  return url.toString();
}

/** Calls setWebhook, then getWebhookInfo to confirm. Returns the info Telegram reports. */
export async function setTelegramWebhook(opts: WebhookOptions): Promise<{ url: string; info: Record<string, unknown> }> {
  if (!opts.token) throw new Error("Falta TELEGRAM_BOT_TOKEN.");
  if (!opts.secret) throw new Error("Falta TELEGRAM_WEBHOOK_SECRET.");
  // Telegram: 1-256 characters, only A-Z, a-z, 0-9, _ and -.
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(opts.secret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET solo puede tener letras, números, _ y - (hasta 256).");
  }
  if (!opts.appUrl) throw new Error("Falta APP_URL.");
  const url = webhookUrl(opts.appUrl);
  const doFetch = opts.fetchImpl ?? (fetch as unknown as Fetch);
  const root = (opts.apiRoot ?? "https://api.telegram.org").replace(/\/+$/, "");
  const call = async (method: string, body: Record<string, unknown>) => {
    const res = (await (
      await doFetch(`${root}/bot${opts.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json()) as { ok: boolean; result?: unknown; description?: string };
    if (!res.ok) throw new Error(`Telegram ${method}: ${res.description ?? "error"}`);
    return res.result;
  };
  await call("setWebhook", {
    url,
    secret_token: opts.secret,
    allowed_updates: ALLOWED_UPDATES,
    drop_pending_updates: opts.dropPendingUpdates ?? false,
  });
  const info = (await call("getWebhookInfo", {})) as Record<string, unknown>;
  if (info.url !== url) throw new Error(`Telegram quedó apuntando a ${String(info.url)} y no a ${url}.`);
  return { url, info };
}

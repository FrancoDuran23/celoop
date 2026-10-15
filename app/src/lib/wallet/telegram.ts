// Telegram's in-app browser doesn't support WebAuthn. Browser-safe.

/**
 * True inside Telegram's in-app browser. Android's webview puts "Telegram" in the user agent;
 * iOS and desktop inject `window.TelegramWebviewProxy` (pass `hasWebviewProxy`).
 */
export function isTelegramInAppBrowser(userAgent: string, hasWebviewProxy = false): boolean {
  return hasWebviewProxy || /telegram/i.test(userAgent);
}

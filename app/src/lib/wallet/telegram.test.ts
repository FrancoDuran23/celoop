import { expect, it } from "vitest";
import { isTelegramInAppBrowser } from "./telegram";

it("detects Telegram's in-app browser", () => {
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36 Telegram-Android/11.2.2";
  const chrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
  const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  expect(isTelegramInAppBrowser(android)).toBe(true);
  expect(isTelegramInAppBrowser(chrome)).toBe(false);
  expect(isTelegramInAppBrowser(safari)).toBe(false);
  expect(isTelegramInAppBrowser(safari, true)).toBe(true);
});

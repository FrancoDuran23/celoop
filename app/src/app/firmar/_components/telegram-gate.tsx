"use client";
// Telegram's in-app browser can't use passkeys: ask to open the link in Chrome or Safari.
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { isTelegramInAppBrowser } from "@/lib/wallet/telegram";
import { Button, Notice, PageTitle } from "./ui";

const subscribe = () => () => {};
const inTelegram = () =>
  isTelegramInAppBrowser(navigator.userAgent, typeof (window as { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy !== "undefined");

export function TelegramGate({ children }: { children: ReactNode }) {
  const blocked = useSyncExternalStore(subscribe, inTelegram, () => false);
  const [copied, setCopied] = useState(false);
  if (!blocked) return <>{children}</>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      window.prompt("Copy this link:", window.location.href);
    }
  };
  const isAndroid = /android/i.test(navigator.userAgent);
  const chromeIntent = `intent://${window.location.host}${window.location.pathname}${window.location.search}#Intent;scheme=https;package=com.android.chrome;end`;

  return (
    <div className="space-y-4">
      <PageTitle>Open this link in Chrome or Safari</PageTitle>
      <p className="text-[15px] leading-relaxed text-muted">
        Signing with your fingerprint, face or PIN doesn’t work inside Telegram. Copy the link and open it in your phone’s browser.
      </p>
      <Button onClick={copy}>{copied ? "Link copied" : "Copy the link"}</Button>
      {isAndroid ? (
        <a className="block text-center font-bold" href={chromeIntent}>
          Open in Chrome
        </a>
      ) : null}
      {copied ? <Notice tone="ok">Done. Now paste it in Chrome or Safari.</Notice> : null}
    </div>
  );
}

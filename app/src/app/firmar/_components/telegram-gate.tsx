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
      window.prompt("Copiá este link:", window.location.href);
    }
  };
  const isAndroid = /android/i.test(navigator.userAgent);
  const chromeIntent = `intent://${window.location.host}${window.location.pathname}${window.location.search}#Intent;scheme=https;package=com.android.chrome;end`;

  return (
    <div className="space-y-4">
      <PageTitle>Abrí este link en Chrome o Safari</PageTitle>
      <p className="text-[15px] leading-relaxed text-black/75 dark:text-white/75">
        Desde Telegram no se puede firmar con la huella, la cara o el PIN. Copiá el link y abrilo en el navegador del
        teléfono.
      </p>
      <Button onClick={copy}>{copied ? "Link copiado" : "Copiar el link"}</Button>
      {isAndroid ? (
        <a className="block text-center font-medium text-emerald-800 underline underline-offset-4 dark:text-emerald-300" href={chromeIntent}>
          Abrir en Chrome
        </a>
      ) : null}
      {copied ? <Notice tone="ok">Listo. Ahora pegalo en Chrome o Safari.</Notice> : null}
    </div>
  );
}

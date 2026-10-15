import type { Metadata } from "next";
import { TelegramGate } from "./_components/telegram-gate";

export const metadata: Metadata = {
  title: "Sign",
  robots: { index: false, follow: false },
};

export default function FirmarLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] sm:pt-10">
      <TelegramGate>{children}</TelegramGate>
    </main>
  );
}

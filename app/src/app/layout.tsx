import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import { Puzzle } from "@/components/Brand";
import { SiteHeader } from "./_components/site-header";
import { APP_NAME, DESCRIPTION, TAGLINE } from "@/lib/brand";

const nunito = Nunito({ subsets: ["latin"], weight: ["400", "600", "700", "800", "900"], variable: "--font-nunito", display: "swap" });

export const metadata: Metadata = {
  title: { default: `${APP_NAME} · ${TAGLINE}`, template: `%s · ${APP_NAME}` },
  description: DESCRIPTION,
  openGraph: { title: `${APP_NAME} · ${TAGLINE}`, description: DESCRIPTION, images: ["/og.jpg"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2f7de1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full antialiased ${nunito.variable}`}>
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <footer className="relative z-10 border-t-[3px] border-ink bg-surface">
          <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 px-4 py-6 text-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted">
              Every movement can be verified on the public ledger. {APP_NAME} never shows member names.
            </p>
            <span className="flex gap-1" aria-hidden="true">
              <Puzzle hue="blue" size={18} tilt={-10} />
              <Puzzle hue="red" size={18} tilt={6} />
              <Puzzle hue="yellow" size={18} tilt={-4} />
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}

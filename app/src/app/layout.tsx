import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Cooperadora Abierta", template: "%s | Cooperadora Abierta" },
  description: "Cuentas de la cooperadora escolar a la vista de todos los socios.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold text-foreground no-underline">
              Cooperadora Abierta
            </Link>
            <span className="text-sm text-muted">Cuentas a la vista</span>
          </div>
        </header>
        <div className="flex-1">{children}</div>
        <footer className="border-t border-line px-4 py-6 text-center text-sm text-muted">
          Cada movimiento se puede verificar. Cooperadora Abierta no muestra nombres de socios.
        </footer>
      </body>
    </html>
  );
}

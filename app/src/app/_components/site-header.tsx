"use client";
// On the landing the header stays out of the way until the person scrolls; everywhere else it is always there.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/Brand";
import { APP_NAME } from "@/lib/brand";

export function SiteHeader() {
  const landing = usePathname() === "/";
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!landing) return;
    const update = () => setScrolled(window.scrollY > 40);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [landing]);

  const hidden = landing && !scrolled;
  return (
    <header
      className={`${landing ? "fixed inset-x-0 top-0" : "sticky top-0"} z-20 border-b-[3px] border-ink bg-surface transition-transform duration-200 ${hidden ? "-translate-y-full" : "translate-y-0"}`}
      aria-hidden={hidden}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-ink no-underline hover:text-ink" aria-label={`${APP_NAME} home`} tabIndex={hidden ? -1 : undefined}>
          <Logo compact />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm font-extrabold">
          <Link href="/#spending" className="text-ink no-underline hover:underline" tabIndex={hidden ? -1 : undefined}>
            Where it goes
          </Link>
          <Link
            href="/ledger"
            className="rounded-lg border-2 border-ink bg-yellow px-3 py-1.5 text-ink no-underline shadow-hard-xs hover:bg-yellow-soft"
            tabIndex={hidden ? -1 : undefined}
          >
            Live ledger
          </Link>
        </nav>
      </div>
    </header>
  );
}

import { cacheLife } from "next/cache";
import { Suspense } from "react";
import { getDb } from "@/db";
import { PanelView } from "@/components/PanelView";
import { parseCoopParam } from "@/lib/coop-query";
import { loadLiveBalance } from "@/lib/report/live-balance";
import { getPanelData, type PanelData } from "@/lib/report/panel";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

async function loadPanel(cooperadoraId: number): Promise<PanelData | null> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 300 });
  try {
    return await getPanelData(getDb(), { cooperadoraId, liveBalance: () => loadLiveBalance(cooperadoraId) });
  } catch {
    return null;
  }
}

/** `?c=<id>` picks the cooperative; without it, the demo. */
async function Ledger({ searchParams }: Props) {
  const c = parseCoopParam((await searchParams).c);
  return <PanelView data={await loadPanel(c)} />;
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<p className="mx-auto max-w-4xl px-4 py-10 text-muted">Loading the ledger…</p>}>
      <Ledger {...props} />
    </Suspense>
  );
}

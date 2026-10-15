import { cacheLife } from "next/cache";
import { getDb } from "@/db";
import { PanelView } from "@/components/PanelView";
import { loadLiveBalance } from "@/lib/report/live-balance";
import { getPanelData, type PanelData } from "@/lib/report/panel";

async function loadPanel(): Promise<PanelData | null> {
  "use cache";
  cacheLife({ stale: 30, revalidate: 30, expire: 300 });
  try {
    return await getPanelData(getDb(), { liveBalance: loadLiveBalance });
  } catch {
    return null;
  }
}

export default async function Home() {
  return <PanelView data={await loadPanel()} />;
}

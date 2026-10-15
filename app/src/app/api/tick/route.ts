import { env } from "@/lib/env";
import { bearerMatches } from "@/lib/orchestrator/auth";
import { productionDeps } from "@/lib/orchestrator/runtime";
import { runTick } from "@/lib/orchestrator/tick";

/** The tick holds its lock for up to 5 minutes. */
export const maxDuration = 300;

/** Called every minute by the external cron with `Authorization: Bearer <TICK_SECRET>`. */
export async function POST(request: Request) {
  if (!bearerMatches(request, env().TICK_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runTick(productionDeps());
  const status = "skipped" in result || result.errors.length === 0 ? 200 : 207;
  // Step summaries carry bigints (block numbers); JSON has no bigint, so send them as strings.
  const body = JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

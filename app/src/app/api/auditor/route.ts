import { env } from "@/lib/env";
import { runAuditor } from "@/lib/auditor";
import { bearerMatches } from "@/lib/orchestrator/auth";
import { productionAuditorDeps } from "@/lib/orchestrator/runtime";

/** The auditor holds its lock for up to 5 minutes. */
export const maxDuration = 300;

/**
 * The auditor's round, called every minute by the external cron next to /api/tick, with
 * `Authorization: Bearer <TICK_SECRET>`. It signs with AUDITOR_PRIVATE_KEY only.
 */
export async function POST(request: Request) {
  if (!bearerMatches(request, env().TICK_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!env().AUDITOR_PRIVATE_KEY) return Response.json({ ok: true, skipped: "AUDITOR_PRIVATE_KEY no está configurada" });
  const result = await runAuditor(productionAuditorDeps());
  const body = JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

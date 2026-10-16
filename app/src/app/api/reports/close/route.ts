import { getDb } from "@/db";
import { isTickAuthorized } from "@/lib/report/auth";
import { isPeriod, previousPeriod } from "@/lib/report/format";
import { closeReport } from "@/lib/report/lifecycle";

/** Internal: the tick calls this when a month ends. Body (optional): { "period": "YYYY-MM" }. */
export async function POST(request: Request) {
  if (!isTickAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { period?: unknown; cooperadoraId?: unknown };
  const period = typeof body.period === "string" ? body.period : previousPeriod(new Date());
  if (!isPeriod(period)) return Response.json({ error: "invalid_period" }, { status: 400 });
  const cooperadoraId = typeof body.cooperadoraId === "number" ? body.cooperadoraId : undefined;
  const { row, created } = await closeReport(getDb(), period, cooperadoraId);
  return Response.json({ period, status: row.status, created });
}

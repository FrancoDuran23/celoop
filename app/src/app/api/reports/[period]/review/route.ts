import { getDb } from "@/db";
import { isPeriod } from "@/lib/report/format";
import { reviewReport } from "@/lib/report/lifecycle";

/** The reviewer confirms the draft with their link token: borrador → revisada. Body: { "token": "..." }. */
export async function POST(request: Request, { params }: { params: Promise<{ period: string }> }) {
  const { period } = await params;
  if (!isPeriod(period)) return Response.json({ error: "invalid_period" }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token : null;
  const result = await reviewReport(getDb(), period, token);
  if (result.ok) return Response.json({ period, status: result.row.status });
  const status = result.error === "not_found" ? 404 : result.error === "bad_token" ? 401 : 409;
  return Response.json({ error: result.error }, { status });
}

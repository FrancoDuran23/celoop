import { getDb } from "@/db";
import { isTickAuthorized } from "@/lib/report/auth";
import { isPeriod } from "@/lib/report/format";
import { publishReport } from "@/lib/report/lifecycle";
import { storePdf } from "@/lib/report/storage";

/** Internal: revisada → publicada. Generates the PDF and stores it. */
export async function POST(request: Request, { params }: { params: Promise<{ period: string }> }) {
  if (!isTickAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { period } = await params;
  if (!isPeriod(period)) return Response.json({ error: "invalid_period" }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { cooperadoraId?: unknown };
  const cooperadoraId = typeof body.cooperadoraId === "number" ? body.cooperadoraId : undefined;
  const result = await publishReport(getDb(), period, storePdf, new Date(), cooperadoraId);
  if (result.ok) return Response.json({ period, status: result.row.status, pdfUrl: result.row.pdfUrl });
  return Response.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
}

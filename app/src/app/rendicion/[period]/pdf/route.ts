import { getDb } from "@/db";
import { isPeriod } from "@/lib/report/format";
import { canView, getReportRow } from "@/lib/report/lifecycle";
import { renderReportPdf } from "@/lib/report/pdf";
import type { ReportData } from "@/lib/report/types";

export async function GET(request: Request, { params }: { params: Promise<{ period: string }> }) {
  const { period } = await params;
  if (!isPeriod(period)) return new Response("No encontrada", { status: 404 });
  const db = getDb();
  const row = await getReportRow(db, period);
  const token = new URL(request.url).searchParams.get("token");
  if (!row || !(await canView(db, row, token))) return new Response("No encontrada", { status: 404 });

  if (row.status === "publicada" && row.pdfUrl?.startsWith("http")) {
    return Response.redirect(row.pdfUrl, 302);
  }
  const bytes = await renderReportPdf(row.data as ReportData);
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="rendicion-${period}.pdf"`,
      "cache-control": row.status === "publicada" ? "public, max-age=300" : "private, no-store",
    },
  });
}

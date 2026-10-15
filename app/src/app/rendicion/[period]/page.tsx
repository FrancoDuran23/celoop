import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getDb } from "@/db";
import { ReportView } from "@/components/ReportView";
import { isPeriod, periodLabel } from "@/lib/report/format";
import { canView, getReportRow } from "@/lib/report/lifecycle";
import type { ReportData } from "@/lib/report/types";

type Props = {
  params: Promise<{ period: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { period } = await params;
  return { title: isPeriod(period) ? `Rendición de ${periodLabel(period)}` : "Rendición" };
}

async function Report({ params, searchParams }: Props) {
  const { period } = await params;
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : null;
  if (!isPeriod(period)) notFound();
  const db = getDb();
  const row = await getReportRow(db, period);
  // Anything that is not published looks like it does not exist unless the reviewer's token is valid.
  if (!row || !(await canView(db, row, token))) notFound();
  const qs = row.status === "publicada" || !token ? "" : `?token=${encodeURIComponent(token)}`;
  return <ReportView report={row.data as ReportData} status={row.status} pdfHref={`/rendicion/${period}/pdf${qs}`} />;
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<p className="mx-auto max-w-4xl px-4 py-10 text-muted">Cargando la rendición...</p>}>
      <Report {...props} />
    </Suspense>
  );
}

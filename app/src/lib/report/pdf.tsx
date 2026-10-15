// The rendición as an A4 PDF, rendered from the same ReportData and column definitions as the web view.
import { Document, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import {
  changeColumns, expenseColumns, incomeColumns, INCOME_CONCEPT_LABEL, lineColumns, type Column,
} from "./columns";
import { formatPesos } from "./format";
import type { IncomeConcept, ReportData } from "./types";
import { APP_NAME } from "@/lib/brand";

const ink = "#1f2933";
const muted = "#52606d";
const rule = "#9aa5b1";

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 54, paddingHorizontal: 32, fontSize: 8, fontFamily: "Helvetica", color: ink },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 10, marginTop: 2, color: muted },
  meta: { marginTop: 8, flexDirection: "row", flexWrap: "wrap" },
  metaItem: { width: "50%", marginBottom: 2 },
  h2: { fontSize: 10, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: ink, paddingBottom: 2 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: rule, paddingVertical: 3 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: ink, paddingVertical: 3, backgroundColor: "#eef1f4" },
  cell: { paddingHorizontal: 3 },
  bold: { fontFamily: "Helvetica-Bold" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: rule },
  sigRow: { flexDirection: "row", marginTop: 56, justifyContent: "space-between" },
  sig: { width: "30%", borderTopWidth: 1, borderTopColor: ink, paddingTop: 3, textAlign: "center" },
  footer: { position: "absolute", bottom: 24, left: 32, right: 32, fontSize: 7, color: muted, flexDirection: "row", justifyContent: "space-between" },
});

function Table<Row>({ columns, rows, report }: { columns: Column<Row>[]; rows: Row[]; report: ReportData }) {
  const cellStyle = (c: Column<Row>) => [s.cell, { flex: c.flex, textAlign: c.align ?? "left" } as const];
  return (
    <View>
      <View style={s.head} fixed>
        {columns.map((c) => (
          <Text key={c.key} style={[...cellStyle(c), s.bold]}>{c.header}</Text>
        ))}
      </View>
      {rows.length === 0 ? (
        <Text style={{ paddingVertical: 4, color: muted }}>Sin movimientos en el período.</Text>
      ) : (
        rows.map((r, i) => (
          <View key={i} style={s.row} wrap={false}>
            {columns.map((c) => (
              <Text key={c.key} style={cellStyle(c)}>
                {c.href?.(r, report) ? (
                  <Link src={c.href(r, report)!} style={{ color: ink }}>{c.value(r, report)}</Link>
                ) : (
                  c.value(r, report)
                )}
              </Text>
            ))}
          </View>
        ))
      )}
    </View>
  );
}

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.totalRow}>
      <Text style={strong ? s.bold : undefined}>{label}</Text>
      <Text style={strong ? s.bold : undefined}>{value}</Text>
    </View>
  );
}

export function ReportPdf({ report, appUrl }: { report: ReportData; appUrl: string }) {
  const h = report.header;
  const concepts = Object.keys(INCOME_CONCEPT_LABEL) as IncomeConcept[];
  return (
    <Document title={`Rendición ${report.periodLabel} - ${h.cooperadora}`} author={APP_NAME}>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>Rendición mensual de cuentas</Text>
        <Text style={s.subtitle}>{report.periodLabel}</Text>
        <View style={s.meta}>
          <Text style={s.metaItem}>Cooperadora: {h.cooperadora}</Text>
          <Text style={s.metaItem}>Escuela: {h.school}</Text>
          <Text style={s.metaItem}>CUIT: {h.cuit}</Text>
          <Text style={s.metaItem}>N° RUCE: {h.ruce ?? "-"}</Text>
        </View>

        <Text style={s.h2}>Saldos</Text>
        <Total label="Saldo inicial" value={formatPesos(report.openingBalance)} />
        <Total label="Ingresos en dinero" value={formatPesos(report.income.totalMoney)} />
        <Total label="Egresos" value={formatPesos(report.expenses.total)} />
        <Total label="Saldo final" value={formatPesos(report.closingBalance)} strong />

        <Text style={s.h2}>Ingresos</Text>
        <Table columns={incomeColumns} rows={report.income.rows} report={report} />
        {concepts.map((k) => (
          <Total key={k} label={`${INCOME_CONCEPT_LABEL[k]} (${report.income.byConcept[k].count})`} value={formatPesos(report.income.byConcept[k].total)} />
        ))}
        <Text style={{ color: muted, marginTop: 3 }}>
          Los aportes en especie y en trabajo se valorizan a mano y no suman al saldo en dinero.
        </Text>

        <Text style={s.h2}>Egresos</Text>
        <Table columns={expenseColumns} rows={report.expenses.rows} report={report} />
        <Total label="Total de egresos" value={formatPesos(report.expenses.total)} strong />

        <Text style={s.h2}>Resumen por partida</Text>
        <Table columns={lineColumns} rows={report.lines} report={report} />

        <Text style={s.h2}>Cambios de presupuesto y configuración</Text>
        <Table columns={changeColumns} rows={report.budgetChanges} report={report} />

        <View style={s.sigRow} wrap={false}>
          {report.signatures.map((sig) => (
            <Text key={sig.role} style={s.sig}>{sig.label}</Text>
          ))}
        </View>

        <View style={s.footer} fixed>
          <Text>Generado por {APP_NAME}. Verificable en {appUrl}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderReportPdf(report: ReportData, appUrl?: string): Promise<Uint8Array> {
  const { env } = await import("@/lib/env");
  const buffer = await renderToBuffer(<ReportPdf report={report} appUrl={appUrl ?? env().APP_URL} />);
  return new Uint8Array(buffer);
}

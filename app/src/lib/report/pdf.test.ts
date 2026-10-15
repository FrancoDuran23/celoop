import { expect, test } from "vitest";
import { createTestDb } from "@/db/testing";
import { buildReport } from "./build";
import { renderReportPdf } from "./pdf";
import { seedReportData } from "./test-seed";
import { APP_NAME } from "@/lib/brand";

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  return out;
}

test("the PDF is generated and contains totals, header and footer", async () => {
  const db = await createTestDb();
  await seedReportData(db);
  const report = await buildReport(db, "2026-10");
  const bytes = await renderReportPdf(report, "https://cooperadora.example");
  expect(bytes.byteLength).toBeGreaterThan(0);
  const text = (await pdfText(bytes)).replace(/\s+/g, " ");
  expect(text).toContain("Cooperadora Escuela 12");
  expect(text).toContain("$ 10.000,00"); // opening balance
  expect(text).toContain("$ 9.000,00"); // total expenses
  expect(text).toContain("$ 8.500,00"); // closing balance
  expect(text).toContain("Librería El Aula");
  expect(text).toContain(`Generado por ${APP_NAME}. Verificable en https://cooperadora.example`);
  expect(text).not.toContain("Marta");
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { createTestDb } from "@/db/testing";
import { buildReport } from "@/lib/report/build";
import { getPanelData } from "@/lib/report/panel";
import { seedReportData, SOCIA_NAME, wars } from "@/lib/report/test-seed";
import { Money } from "./Money";
import { PanelView } from "./PanelView";
import { ReportView } from "./ReportView";

const NOW = new Date("2026-10-20T12:00:00Z");

test("Money shows es-AR pesos", () => {
  expect(renderToStaticMarkup(createElement(Money, { value: wars(12500) }))).toContain("$ 12.500,00");
});

test("the panel renders from seeded data without names", async () => {
  const db = await createTestDb();
  await seedReportData(db);
  const data = await getPanelData(db, { now: NOW });
  const html = renderToStaticMarkup(createElement(PanelView, { data }));
  expect(html).toContain("Cooperadora Escuela 12");
  expect(html).toContain("$ 8.500,00"); // 10000+5000+2500 - 4000 - 5000
  expect(html).toContain("Presupuesto 2026 vencido, en uso hasta la próxima asamblea.");
  expect(html).toContain("Automático (dentro del tope)");
  expect(html).toContain("Con firmas (2 de 3)");
  expect(html).toContain("Excedió la partida");
  expect(html).toContain("faltan 1");
  expect(html).toContain("Presidente, Tesorero");
  expect(html).not.toContain(SOCIA_NAME);
  expect(html).not.toContain("Marta");
  expect(html.toLowerCase()).not.toMatch(/\bgas\b/);
});

test("the live balance wins when available and falls back when it fails", async () => {
  const db = await createTestDb();
  await seedReportData(db);
  const live = await getPanelData(db, { now: NOW, liveBalance: async () => BigInt(wars(777)) });
  expect(live?.balance).toBe(wars(777));
  expect(live?.balanceSource).toBe("chain");
  const failing = await getPanelData(db, { now: NOW, liveBalance: async () => { throw new Error("rpc"); } });
  expect(failing?.balance).toBe(wars(8500));
  expect(failing?.balanceSource).toBe("db");
});

test("the panel survives an empty database", () => {
  expect(renderToStaticMarkup(createElement(PanelView, { data: null }))).toContain("Todavía no hay datos");
});

test("the report view renders every section", async () => {
  const db = await createTestDb();
  await seedReportData(db);
  const html = renderToStaticMarkup(createElement(ReportView, { report: await buildReport(db, "2026-10"), status: "borrador" }));
  for (const text of ["Saldo inicial", "Saldo final", "Aportes sin identificar", "Factura C", "Resumen por partida", "Revisor/a de cuentas", "Borrador para revisar"]) {
    expect(html).toContain(text);
  }
  expect(html).not.toContain("Marta");
});

import { beforeEach, expect, test } from "vitest";
import { createTestDb } from "@/db/testing";
import type { Db } from "@/db";
import { buildReport } from "./build";
import { formatPesos } from "./format";
import { seedReportData, SOCIA_NAME, wars } from "./test-seed";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await seedReportData(db);
});

test("totals add up: opening + income - expenses = closing", async () => {
  const r = await buildReport(db, "2026-10");
  expect(r.openingBalance).toBe(wars(10000));
  expect(r.income.totalMoney).toBe(wars(7500));
  expect(r.expenses.total).toBe(wars(9000));
  expect(BigInt(r.openingBalance) + BigInt(r.income.totalMoney) - BigInt(r.expenses.total)).toBe(BigInt(r.closingBalance));
  expect(formatPesos(r.closingBalance)).toBe("$ 8.500,00");
});

test("income is grouped by concept, includes especie and trabajo, and has no names", async () => {
  const r = await buildReport(db, "2026-10");
  expect(r.income.byConcept.aportes_socios).toEqual({ count: 1, total: wars(5000) });
  expect(r.income.byConcept.sin_identificar).toEqual({ count: 1, total: wars(2500) });
  expect(r.income.byConcept.especie.total).toBe(wars(8000));
  expect(r.income.byConcept.trabajo.total).toBe(wars(3000));
  expect(r.income.totalInKind).toBe(wars(11000));
  const json = JSON.stringify(r);
  expect(json).not.toContain("Marta");
  expect(json).not.toContain(SOCIA_NAME);
  expect(json).not.toContain("Raul");
});

test("expenses carry the invoice data and flag overruns", async () => {
  const r = await buildReport(db, "2026-10");
  expect(r.expenses.rows).toHaveLength(2);
  const [a, b] = r.expenses.rows;
  expect(a).toMatchObject({
    vendor: "Librería El Aula S.R.L.", cuit: "30-70000000-1", comprobanteTipo: "Invoice C",
    comprobanteNumero: "0003-00001234", concept: "Resmas y marcadores", rule: "auto", overBudget: false,
  });
  expect(b).toMatchObject({ rule: "signers", overBudget: true, budgetExpired: true });
  expect(r.lines.find((l) => l.slug === "mantenimiento")?.over).toBe(true);
});

test("budget changes list signers by role", async () => {
  const r = await buildReport(db, "2026-10");
  expect(r.budgetChanges).toHaveLength(1);
  expect(r.budgetChanges[0].signers).toEqual(["President", "Treasurer"]);
  expect(r.budgetChanges[0].reason).toBe("Reparación urgente del techo");
  expect(r.budgetChanges[0].description).toContain("Mantenimiento");
});

test("a month without movements still balances", async () => {
  const r = await buildReport(db, "2026-11");
  expect(r.income.rows).toEqual([]);
  expect(r.expenses.rows).toEqual([]);
  expect(r.openingBalance).toBe(r.closingBalance);
  expect(r.openingBalance).toBe(wars(8500));
});

test("is deterministic", async () => {
  expect(await buildReport(db, "2026-10")).toEqual(await buildReport(db, "2026-10"));
});

test("rejects a bad period", async () => {
  await expect(buildReport(db, "2026-13")).rejects.toThrow();
});

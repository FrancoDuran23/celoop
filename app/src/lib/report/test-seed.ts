// Seeded data shared by the report, panel and API tests.
import type { Db } from "@/db";
import {
  approvals, budgetIndex, budgetLines, chainEvents, contributions, cooperadora, invoices,
  payments, persons, proposals, signLinks, vendors,
} from "@/db/schema";

export const PESO = BigInt("1000000000000000000");
export const wars = (pesos: number) => (BigInt(pesos) * PESO).toString();
const hex = (n: number) => "0x" + n.toString(16).padStart(64, "0");
export const LINE_MATERIALES = hex(1);
export const LINE_MANTENIMIENTO = hex(2);
export const SOCIA_NAME = "Marta Gonzalez";
export const REVIEW_TOKEN = "review-token-1";
const SAFE_PRES = "0x00000000000000000000000000000000000000a1";
const SAFE_TES = "0x00000000000000000000000000000000000000a2";
const VENDOR_ADDR = "0x00000000000000000000000000000000000000b1";

/** Cooperadora with money in September and October 2026, and a payment in October. */
export async function seedReportData(db: Db) {
  await db.insert(cooperadora).values({
    name: "Cooperadora Escuela 12", school: "Escuela N° 12 Gral. Belgrano", cuit: BigInt("30712345678"),
    ruce: "RUCE-0456", chainId: 42220, treasuryAddress: "0x00000000000000000000000000000000000000c1",
    boxFactoryAddress: "0x00000000000000000000000000000000000000c2", configHash: hex(9),
  });
  const people = await db.insert(persons).values([
    { name: SOCIA_NAME, phone: "+5493880000001", roles: ["socio"] },
    { name: "Raul Presidente", phone: "+5493880000002", roles: ["presidente"], safeAddress: SAFE_PRES },
    { name: "Tere Tesorera", phone: "+5493880000003", roles: ["tesorero"], safeAddress: SAFE_TES },
    { name: "Rita Revisora", phone: "+5493880000004", roles: ["revisor"] },
  ]).returning();
  await db.insert(budgetLines).values([
    { lineId: LINE_MATERIALES, slug: "materiales", name: "Materiales" },
    { lineId: LINE_MANTENIMIENTO, slug: "mantenimiento", name: "Mantenimiento" },
  ]);
  await db.insert(budgetIndex).values([
    { lineId: LINE_MATERIALES, allocated: wars(50000), spent: wars(20000), periodEnd: 1_900_000_000 },
    { lineId: LINE_MANTENIMIENTO, allocated: wars(10000), spent: wars(12000), periodEnd: 1_700_000_000 },
  ]);
  await db.insert(vendors).values({ legalName: "Librería El Aula S.R.L.", cuit: BigInt("30700000001"), address: VENDOR_ADDR });

  await db.insert(contributions).values([
    { personId: people[0].id, amount: wars(10000), kind: "dinero", txHash: hex(100), logIndex: 0, occurredAt: new Date("2026-09-10T15:00:00Z") },
    { personId: people[0].id, amount: wars(5000), kind: "dinero", txHash: hex(101), logIndex: 0, occurredAt: new Date("2026-10-05T15:00:00Z") },
    { personId: null, amount: wars(2500), kind: "dinero", txHash: hex(102), logIndex: 0, occurredAt: new Date("2026-10-07T15:00:00Z") },
    { personId: null, amount: wars(8000), kind: "especie", memo: "Pintura donada por Marta", occurredAt: new Date("2026-10-09T15:00:00Z") },
    { personId: null, amount: wars(3000), kind: "trabajo", occurredAt: new Date("2026-10-12T15:00:00Z") },
  ]);

  await db.insert(invoices).values({
    uploaderPersonId: people[2].id, vendorId: 1, status: "pagada", cuit: BigInt("30700000001"), tipo: 11,
    ptoVta: 3, nro: BigInt(1234), amount: wars(4000), fileUrl: "https://files.example/factura-1.pdf",
    fileHash: hex(55), lineId: LINE_MATERIALES, invoiceId: hex(77), paymentId: BigInt(1),
    extracted: { concept: "Resmas y marcadores" },
  });
  await db.insert(payments).values([
    {
      paymentId: BigInt(1), vendor: VENDOR_ADDR, amount: wars(4000), lineId: LINE_MATERIALES, invoiceId: hex(77),
      fileHash: hex(55), status: "executed", rule: "auto", approvals: 0, executedTxHash: hex(200),
      executedAt: new Date("2026-10-08T15:00:00Z"),
    },
    {
      paymentId: BigInt(2), vendor: VENDOR_ADDR, amount: wars(5000), lineId: LINE_MANTENIMIENTO, invoiceId: hex(78),
      fileHash: hex(56), status: "executed", rule: "signers", approvals: 2, overBudget: true, budgetExpired: true,
      executedTxHash: hex(201), executedAt: new Date("2026-10-15T15:00:00Z"),
    },
    {
      paymentId: BigInt(3), vendor: VENDOR_ADDR, amount: wars(1500), lineId: LINE_MATERIALES, invoiceId: hex(79),
      fileHash: hex(57), status: "pending", approvals: 1,
    },
  ]);

  await db.insert(proposals).values({
    proposalId: BigInt(1), kind: "MoveBudget", data: "0x", status: "executed", proposer: SAFE_TES,
    decoded: { fromLine: LINE_MATERIALES, toLine: LINE_MANTENIMIENTO, amount: wars(2000) },
    reasonText: "Reparación urgente del techo", executedTxHash: hex(300), approvals: 2,
  });
  await db.insert(approvals).values([
    { target: "proposal", targetId: BigInt(1), signer: SAFE_PRES, txHash: hex(301), logIndex: 0, occurredAt: new Date("2026-10-14T10:00:00Z") },
    { target: "proposal", targetId: BigInt(1), signer: SAFE_TES, txHash: hex(302), logIndex: 0, occurredAt: new Date("2026-10-14T11:00:00Z") },
  ]);
  await db.insert(chainEvents).values([
    { blockNumber: BigInt(10), blockTime: new Date("2026-09-01T00:00:00Z"), txHash: hex(400), logIndex: 0, address: "0x1", eventName: "SignersSet", args: { signers: ["a", "b", "c"], threshold: "2" } },
    { blockNumber: BigInt(20), blockTime: new Date("2026-10-14T12:00:00Z"), txHash: hex(300), logIndex: 1, address: "0x1", eventName: "ProposalExecuted", args: { proposalId: "1", kind: "1" } },
  ]);
  await db.insert(signLinks).values({
    token: REVIEW_TOKEN, personId: people[3].id, purpose: "review", target: { period: "2026-10" },
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  });
  return { people };
}

// Two cooperatives in one database: same budget line slug, same vendor CUIT, overlapping payment
// ids. Nothing one does may read, pay, notify or authorize anything in the other.
import { eq } from "drizzle-orm";
import { keccak256, toHex, type Address } from "viem";
import { describe, expect, test } from "vitest";
import { budgetIndex, budgetLines, cooperadora, invoices, memberships, payments, persons, signLinks, vendors } from "@/db/schema";
import { getPanelData } from "@/lib/report/panel";
import type { AgentDeps } from "./deps";
import { pesos } from "./format";
import { chooseLine, processInvoice, syncInvoices } from "./invoice";
import { resolveReview } from "./review";
import { buttonUrls, FakeChain, invoiceFields, LINE_MATERIALES, pdfFile, testAgent, VENDOR_CUIT } from "./testing";

const COOP2_CUIT = BigInt("30799999991");
const VENDOR2_ADDRESS = "0x00000000000000000000000000000000000000b2" as Address;

async function twoCoops() {
  const t = await testAgent();
  const { db, people } = t;
  // A migrated database: the demo's padrón is also in memberships.
  for (const p of Object.values(people)) {
    if ("phone" in p) await db.insert(memberships).values({ personId: p.id, cooperadoraId: 1, roles: p.roles });
  }
  const [coop2] = await db
    .insert(cooperadora)
    .values({
      name: "Cooperadora Escuela 40",
      school: "Escuela N° 40",
      cuit: COOP2_CUIT,
      chainId: 42220,
      treasuryAddress: "0x00000000000000000000000000000000000000d1",
      boxFactoryAddress: "0x00000000000000000000000000000000000000d2",
      status: "active",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    })
    .returning();
  // People of the second cooperative: no roles in persons.roles, only their membership.
  const [presidente2, tesorero2, revisor2] = await db
    .insert(persons)
    .values([
      { name: "Paula Presidenta", phone: "+5491100000001", roles: [], safeAddress: "0x00000000000000000000000000000000000000e1", telegramUserId: BigInt(2001), telegramChatId: BigInt(2001) },
      { name: "Tomás Tesorero", phone: "+5491100000002", roles: [], safeAddress: "0x00000000000000000000000000000000000000e2", telegramUserId: BigInt(2002), telegramChatId: BigInt(2002) },
      { name: "Rocío Revisora", phone: "+5491100000003", roles: [], safeAddress: "0x00000000000000000000000000000000000000e3", telegramUserId: BigInt(2003), telegramChatId: BigInt(2003) },
    ])
    .returning();
  await db.insert(memberships).values([
    { personId: presidente2.id, cooperadoraId: coop2.id, roles: ["socio", "presidente"] },
    { personId: tesorero2.id, cooperadoraId: coop2.id, roles: ["socio", "tesorero"] },
    { personId: revisor2.id, cooperadoraId: coop2.id, roles: ["socio", "revisor"] },
  ]);
  // The same line slug and the same vendor CUIT, paid into another address.
  await db.insert(budgetLines).values({ cooperadoraId: coop2.id, lineId: LINE_MATERIALES, slug: "materiales", name: "Útiles" });
  await db.insert(budgetIndex).values({ cooperadoraId: coop2.id, lineId: LINE_MATERIALES, allocated: pesos(90000).toString(), spent: "0", periodEnd: 1_900_000_000 });
  const [vendor2] = await db
    .insert(vendors)
    .values({ cooperadoraId: coop2.id, legalName: "Librería El Aula (sucursal)", cuit: VENDOR_CUIT, address: VENDOR2_ADDRESS })
    .returning();
  const chain2 = new FakeChain();
  const deps2: AgentDeps = { ...t.deps, cooperadoraId: coop2.id, chain: chain2 };
  return { ...t, coop2, chain2, deps2, vendor2, people2: { presidente2, tesorero2, revisor2 } };
}

type T = Awaited<ReturnType<typeof twoCoops>>;

async function upload(t: T, deps: AgentDeps, uploaderId: number, importe: string, nro: number, receptor = COOP2_CUIT) {
  t.reader.queue(invoiceFields({ importe, nro: BigInt(nro), receptorDocNro: receptor }));
  return processInvoice(deps, { uploaderPersonId: uploaderId, file: pdfFile(nro % 250) });
}

const invoiceRow = async (t: T, id: number) => (await t.db.select().from(invoices).where(eq(invoices.id, id)))[0];

describe("two cooperatives in one database", () => {
  test("an invoice is validated, proposed and sent for signatures inside its own cooperative only", async () => {
    const t = await twoCoops();
    const { tesorero2, presidente2 } = t.people2;
    const out = await upload(t, t.deps2, tesorero2.id, "15000.00", 41);
    expect(out.status).toBe("validada");
    const row = await invoiceRow(t, out.invoiceId);
    expect(row.cooperadoraId).toBe(t.coop2.id);
    expect(row.vendorId).toBe(t.vendor2.id);

    // The line buttons are this cooperative's (its own name for the same slug).
    expect(t.tg.to(tesorero2.id).at(-1)!.buttons).toEqual([[expect.objectContaining({ text: expect.stringContaining("Útiles") })]]);

    t.tg.clear();
    const chosen = await chooseLine(t.deps2, { personId: tesorero2.id, invoiceRowId: out.invoiceId, slug: "materiales" });
    expect(chosen.status).toBe("pendiente");
    expect(t.chain2.proposals).toEqual([expect.objectContaining({ vendor: VENDOR2_ADDRESS, lineId: LINE_MATERIALES })]);
    expect((t.chain as FakeChain).proposals).toEqual([]);

    // Only this cooperative's signers hear about it, and their links open its treasury.
    const told = new Set(t.tg.sent.map((m) => m.personId));
    expect(told.has(presidente2.id)).toBe(true);
    for (const p of [t.people.presidente, t.people.tesorera, t.people.secretario, t.people.revisora]) expect(told.has(p.id)).toBe(false);
    const url = buttonUrls(t.tg.to(presidente2.id).at(-1)!.buttons)[0];
    const token = decodeURIComponent(new URL(url).searchParams.get("t")!);
    const [link] = await t.db.select().from(signLinks).where(eq(signLinks.token, token));
    expect(link.cooperadoraId).toBe(t.coop2.id);
  });

  test("an invoice made out to the other cooperative is rejected", async () => {
    const t = await twoCoops();
    const out = await upload(t, t.deps2, t.people2.tesorero2.id, "4000.00", 42, BigInt("30712345678"));
    expect(out.status).toBe("rechazada");
  });

  test("payment #1 of one treasury never moves payment #1 of the other", async () => {
    const t = await twoCoops();
    const a = await upload(t, t.deps, t.people.tesorera.id, "15000.00", 43, BigInt("30712345678"));
    await chooseLine(t.deps, { personId: t.people.tesorera.id, invoiceRowId: a.invoiceId, slug: "materiales" });
    const b = await upload(t, t.deps2, t.people2.tesorero2.id, "15000.00", 44);
    await chooseLine(t.deps2, { personId: t.people2.tesorero2.id, invoiceRowId: b.invoiceId, slug: "materiales" });
    expect((await invoiceRow(t, a.invoiceId)).paymentId).toBe(BigInt(1));
    expect((await invoiceRow(t, b.invoiceId)).paymentId).toBe(BigInt(1));

    // The second treasury executes its payment #1.
    await t.db.insert(payments).values({
      cooperadoraId: t.coop2.id,
      paymentId: BigInt(1),
      vendor: VENDOR2_ADDRESS,
      amount: pesos(15000).toString(),
      lineId: LINE_MATERIALES,
      invoiceId: (await invoiceRow(t, b.invoiceId)).invoiceId!,
      fileHash: (await invoiceRow(t, b.invoiceId)).fileHash,
      status: "executed",
      rule: "signers",
      executedTxHash: keccak256(toHex("exec-2-1")),
      executedAt: new Date("2026-10-14T16:00:00Z"),
    });
    await syncInvoices(t.deps);
    expect((await invoiceRow(t, a.invoiceId)).status).toBe("pendiente");
    await syncInvoices(t.deps2);
    expect((await invoiceRow(t, b.invoiceId)).status).toBe("pagada");
  });

  test("an invoice in review goes to its own reviewers, and someone from the other cooperative can't resolve it", async () => {
    const t = await twoCoops();
    t.reader.next.push({ ok: false, reason: "El QR y la lectura no coinciden; la reviso con una persona" });
    t.tg.clear();
    const out = await processInvoice(t.deps2, { uploaderPersonId: t.people2.tesorero2.id, file: pdfFile(45) });
    expect(out.status).toBe("revision");
    const cards = t.tg.sent.filter((m) => m.text.startsWith("Hay una factura para revisar")).map((m) => m.personId);
    expect(cards.sort()).toEqual([t.people2.presidente2.id, t.people2.revisor2.id].sort());

    // The demo's revisora, even pressing the button from her chat in the demo.
    const fromDemo = await resolveReview(t.deps, { personId: t.people.revisora.id, invoiceRowId: out.invoiceId, decision: "rechazar" });
    expect(fromDemo.error).toBe("not_allowed");
    const asIfHere = await resolveReview(t.deps2, { personId: t.people.revisora.id, invoiceRowId: out.invoiceId, decision: "rechazar" });
    expect(asIfHere.error).toBe("not_allowed");
    expect((await invoiceRow(t, out.invoiceId)).status).toBe("revision");

    const own = await resolveReview(t.deps2, { personId: t.people2.revisor2.id, invoiceRowId: out.invoiceId, decision: "rechazar" });
    expect(own.status).toBe("rechazada");
  });

  test("the demo's comisión can't choose the line of the other cooperative's invoice", async () => {
    const t = await twoCoops();
    const out = await upload(t, t.deps2, t.people2.tesorero2.id, "4000.00", 46);
    const r = await chooseLine(t.deps2, { personId: t.people.tesorera.id, invoiceRowId: out.invoiceId, slug: "materiales" });
    expect(r.status).toBe("validada");
    expect(t.chain2.proposals).toEqual([]);
  });

  test("the public panel shows one cooperative at a time", async () => {
    const t = await twoCoops();
    const one = await getPanelData(t.db, { cooperadoraId: 1 });
    const two = await getPanelData(t.db, { cooperadoraId: t.coop2.id });
    expect(one!.header.cooperadora).toBe("Cooperadora Escuela 12");
    expect(one!.lines.map((l) => l.name).sort()).toEqual(["Mantenimiento", "Materiales"]);
    expect(two!.header.cooperadora).toBe("Cooperadora Escuela 40");
    expect(two!.lines.map((l) => l.name)).toEqual(["Útiles"]);
    expect(two!.cooperadoraId).toBe(t.coop2.id);
  });
});

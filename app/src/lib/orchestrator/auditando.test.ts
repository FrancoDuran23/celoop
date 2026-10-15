// The treasurer's side of the auditor: proposals wait in `auditando` for the auditor's verdict.
import { eq } from "drizzle-orm";
import { pad } from "viem";
import { describe, expect, test } from "vitest";
import { audits, invoices } from "@/db/schema";
import { AUDIT_TIMEOUT_MS, chooseLine, processInvoice, syncInvoices } from "./invoice";
import { invoiceFields, pdfFile, testAgent } from "./testing";

type T = Awaited<ReturnType<typeof testAgent>>;

async function propose(t: T, importe: string, nro = 1234) {
  t.reader.queue(invoiceFields({ importe, nro: BigInt(nro) }));
  const out = await processInvoice(t.deps, { uploaderPersonId: t.people.tesorera.id, file: pdfFile(nro % 250) });
  expect(out.status).toBe("validada");
  const chosen = await chooseLine(t.deps, { personId: t.people.tesorera.id, invoiceRowId: out.invoiceId, slug: "materiales" });
  return { id: out.invoiceId, chosen };
}

const row = async (t: T, id: number) => (await t.db.select().from(invoices).where(eq(invoices.id, id)))[0];

/** The auditor, faked: decides `cleared` for every waiting payment and stores its findings. */
function wireAuditor(t: T, cleared: boolean, findings: { code: string; level: string; text: string }[] = []) {
  t.chain.withAuditor = true;
  t.deps.auditNow = async () => {
    for (const [id, st] of t.chain.states) {
      if (st.audit !== "none") continue;
      await t.db.insert(audits).values({
        paymentId: BigInt(id),
        verdict: cleared ? "cleared" : "flagged",
        findings,
        reportJson: "{}",
        reportHash: pad("0x01", { size: 32 }),
      });
      await t.chain.audit(BigInt(id), cleared);
    }
  };
}

describe("payments that wait for the auditor", () => {
  test("cleared and small: paid right after the auditor's review, and everyone is told it was audited", async () => {
    const t = await testAgent();
    wireAuditor(t, true);
    const { id, chosen } = await propose(t, "4000.00");
    expect(chosen.status).toBe("pagada");
    expect((await row(t, id)).status).toBe("pagada");

    const toUploader = t.tg.to(t.people.tesorera.id).map((m) => m.text);
    expect(toUploader.at(-2)).toContain("lo revisa el auditor");
    expect(toUploader.at(-1)).toContain("El auditor la revisó y entró en las reglas de pago automático");
    const toReviewer = t.tg.to(t.people.revisora.id).map((m) => m.text).join("\n");
    expect(toReviewer).toContain("Pago automático (revisado por el auditor)");
    expect(toReviewer).toContain("https://coop.test/auditoria/1");
  });

  test("flagged: goes to the signers with the auditor's observations, and the uploader hears why", async () => {
    const t = await testAgent();
    wireAuditor(t, false, [
      { code: "POSIBLE_COMPRA_PARTIDA", level: "observacion", text: "Puede ser una compra partida en varias facturas." },
      { code: "PROVEEDOR_NUEVO", level: "nota", text: "Es el primer pago a este proveedor." },
    ]);
    const { id, chosen } = await propose(t, "4000.00");
    expect(chosen.status).toBe("pendiente");
    expect(await row(t, id)).toMatchObject({ status: "pendiente", statusReason: "observada por el auditor" });

    const ask = t.tg.to(t.people.presidente.id).at(-1)!;
    expect(ask.text).toContain("Hay un pago que necesita tu firma");
    expect(ask.text).toContain("El auditor la observó y no la dejó salir automática");
    expect(ask.text).toContain("• Puede ser una compra partida");
    expect(ask.text).not.toContain("primer pago"); // notes stay in the report
    expect(t.tg.to(t.people.tesorera.id).at(-1)!.text).toContain("No la pago sola: se la mandé a los firmantes");
  });

  test("cleared but over the cap: to the signers, saying the auditor found nothing", async () => {
    const t = await testAgent();
    wireAuditor(t, true);
    const { chosen } = await propose(t, "15000.00");
    expect(chosen.status).toBe("pendiente");
    expect(t.tg.to(t.people.revisora.id).at(-1)!.text).toContain("El auditor la revisó y no encontró problemas");
    expect(t.tg.to(t.people.tesorera.id).at(-1)!.text).toContain("no entra en las reglas de pago automático");
  });

  test("without a quick review it waits, and the tick moves it once the index has the verdict", async () => {
    const t = await testAgent();
    t.chain.withAuditor = true; // no auditNow: the cron's auditor round will get to it
    const { id, chosen } = await propose(t, "4000.00");
    expect(chosen.status).toBe("auditando");

    await syncInvoices(t.deps);
    expect((await row(t, id)).status).toBe("auditando");

    t.indexer.payment(BigInt(1), "executed", { rule: "auto", audit: "cleared" });
    await t.indexer.run();
    await syncInvoices(t.deps);
    expect((await row(t, id)).status).toBe("pagada");
    expect(t.tg.to(t.people.tesorera.id).at(-1)!.text).toContain("El auditor la revisó");
  });

  test("if the auditor doesn't answer in time it goes to the signers and the operator hears about it", async () => {
    const t = await testAgent();
    const [operador] = await t.db
      .insert((await import("@/db/schema")).persons)
      .values({ name: "Op", phone: "+5493880000099", roles: ["operador"], telegramUserId: BigInt(1099), telegramChatId: BigInt(1099) })
      .returning();
    t.chain.withAuditor = true;
    const { id } = await propose(t, "4000.00");
    t.indexer.payment(BigInt(1), "pending");
    await t.indexer.run();

    t.clock.now = new Date(t.clock.now.getTime() + AUDIT_TIMEOUT_MS + 1000);
    await syncInvoices(t.deps);
    expect(await row(t, id)).toMatchObject({ status: "pendiente", statusReason: "el auditor no respondió" });
    expect(t.tg.to(t.people.presidente.id).at(-1)!.text).toContain("El auditor todavía no la revisó");
    expect(t.tg.to(operador.id).at(-1)!.text).toContain("el auditor no revisó el pago #1");

    // A late clearance still pays it automatically; the signers are told no signature was needed.
    t.indexer.payment(BigInt(1), "executed", { rule: "auto", audit: "cleared" });
    await t.indexer.run();
    await syncInvoices(t.deps);
    expect((await row(t, id)).status).toBe("pagada");
    expect(t.tg.to(t.people.presidente.id).at(-1)!.text).toContain("no hizo falta firmar");
  });
});

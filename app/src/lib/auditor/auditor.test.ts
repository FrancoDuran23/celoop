import { eq } from "drizzle-orm";
import { keccak256, pad, stringToBytes, toHex, zeroAddress, type Address, type Hex } from "viem";
import { describe, expect, test } from "vitest";
import { audits, chainEvents, contributions, indexerCursor, invoices, payments, persons } from "@/db/schema";
import type { OnchainPayment } from "@/lib/chain/treasury";
import { invoiceIdOf, toWarsUnits, type InvoiceFields, type InvoiceFile } from "@/lib/invoice";
import { withLock } from "@/lib/locks";
import { pesos } from "@/lib/orchestrator/format";
import { invoiceFields, LINE_MATERIALES, memoryNotifier, PER_TX_CAP, seed, VENDOR_ADDRESS, COOP_CUIT } from "@/lib/orchestrator/testing";
import { createTestDb } from "@/db/testing";
import { isFlagged, runChecks, type AuditInput } from "./checks";
import type { AuditorChain, AuditorDeps } from "./deps";
import { AUDITOR_TX_LOCK, buildAuditReport, reconcileBalance, runAuditor } from "./index";

const SELF = "0x00000000000000000000000000000000000000d1" as Address;
const NOW = new Date("2026-10-14T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

// ── Pure checks ─────────────────────────────────────────────────────────────

function input(over: Partial<AuditInput> = {}, qrOver: Partial<InvoiceFields> = {}): AuditInput {
  const qr = invoiceFields({ importe: "4000.00", fecha: "2026-10-10", ...qrOver });
  return {
    payment: { paymentId: BigInt(5), vendor: VENDOR_ADDRESS, amount: pesos(4000), invoiceId: invoiceIdOf(qr), fileHash: pad("0x0f", { size: 32 }) },
    hasInvoice: true,
    storedFileHash: pad("0x0f", { size: 32 }),
    qr,
    cooperadoraCuit: COOP_CUIT,
    perTxCap: PER_TX_CAP,
    history: [{ paymentId: BigInt(1), amount: pesos(9000), at: new Date(NOW.getTime() - 40 * DAY), invoiceLabel: "Factura C 00003-00000001" }],
    now: NOW,
    ...over,
  };
}
const codes = (i: AuditInput) => runChecks(i).map((f) => `${f.level}:${f.code}`);

describe("checks", () => {
  test("a clean payment has no observations", () => {
    expect(runChecks(input())).toEqual([]);
    expect(isFlagged(runChecks(input()))).toBe(false);
  });

  test("a first payment to a vendor is only a note", () => {
    const findings = runChecks(input({ history: [] }));
    expect(findings).toEqual([{ code: "PROVEEDOR_NUEVO", level: "nota", text: "Es el primer pago a este proveedor." }]);
    expect(isFlagged(findings)).toBe(false);
  });

  test("no invoice behind the payment, or a different file, is flagged", () => {
    expect(codes(input({ hasInvoice: false, storedFileHash: null, qr: null }))).toEqual(["observacion:SIN_FACTURA"]);
    expect(codes(input({ storedFileHash: pad("0x0e", { size: 32 }) }))).toEqual(["observacion:ARCHIVO_DISTINTO"]);
  });

  test("the auditor's own QR reading must match the payment", () => {
    expect(codes(input({ qr: null }))).toEqual(["observacion:SIN_QR"]);
    const other = input();
    other.qr = { ...other.qr!, nro: BigInt(999) };
    expect(codes(other)).toEqual(["observacion:QR_DISTINTO"]);
    const pricier = input();
    pricier.qr = { ...pricier.qr!, importe: "4500.00" };
    expect(runChecks(pricier)).toEqual([
      expect.objectContaining({ code: "MONTO_DISTINTO", text: expect.stringContaining("$ 4.500,00") }),
    ]);
    expect(codes(input({}, { receptorDocNro: BigInt("20999999990") }))).toEqual(["observacion:RECEPTOR_INCORRECTO"]);
    expect(codes(input({}, { receptorDocTipo: null, receptorDocNro: null }))).toEqual(["nota:SIN_RECEPTOR_EN_QR"]);
    expect(codes(input({}, { fecha: "2026-07-01" }))).toEqual(["nota:FACTURA_VIEJA"]);
  });

  test("small payments to one vendor that add up past the cap in a week look like a split purchase", () => {
    const recent = (amount: bigint, daysAgo: number, id = 2) => ({ paymentId: BigInt(id), amount, at: new Date(NOW.getTime() - daysAgo * DAY), invoiceLabel: null });
    expect(codes(input({ history: [recent(pesos(7000), 2)] }))).toEqual(["observacion:POSIBLE_COMPRA_PARTIDA"]);
    // Older than a week, or a big one the signers already looked at: not a split.
    expect(codes(input({ history: [recent(pesos(7000), 9)] }))).toEqual([]);
    expect(codes(input({ history: [recent(pesos(15000), 1)] }))).toEqual([]);
    // Under the cap all together: fine.
    expect(codes(input({ history: [recent(pesos(3000), 1)] }))).toEqual([]);
  });

  test("the same amount to the same vendor within a month looks like a repeated invoice", () => {
    const twin = { paymentId: BigInt(2), amount: pesos(4000), at: new Date(NOW.getTime() - 12 * DAY), invoiceLabel: "Factura C 00003-00000077" };
    const findings = runChecks(input({ history: [twin] }));
    expect(findings.map((f) => f.code)).toEqual(["POSIBLE_FACTURA_REPETIDA"]);
    expect(findings[0].text).toContain("hace 12 días (Factura C 00003-00000077)");
  });
});

describe("report", () => {
  test("the hash is the keccak256 of the exact JSON text, and the key order is fixed", () => {
    const args = {
      chainId: 42220,
      treasury: "0x00000000000000000000000000000000000000c1",
      auditor: SELF,
      paymentId: BigInt(3),
      payment: { vendor: VENDOR_ADDRESS, amount: pesos(1), lineId: LINE_MATERIALES, invoiceId: pad("0x01", { size: 32 }), fileHash: pad("0x02", { size: 32 }) },
      findings: [{ code: "SIN_QR" as const, level: "observacion" as const, text: "x" }],
      checkedAt: NOW,
    };
    const a = buildAuditReport(args);
    expect(a.hash).toBe(keccak256(stringToBytes(a.json)));
    expect(a.report.verdict).toBe("flagged");
    expect(Object.keys(JSON.parse(a.json))).toEqual(["kind", "version", "chainId", "treasury", "auditor", "paymentId", "payment", "verdict", "findings", "checkedAt"]);
    expect(buildAuditReport({ ...args, payment: { ...args.payment } }).hash).toBe(a.hash);
  });
});

// ── The auditor's round ─────────────────────────────────────────────────────

class FakeAuditorChain implements AuditorChain {
  auditor: Address = SELF;
  onchain = new Map<string, OnchainPayment>();
  verdicts = new Map<string, { cleared: boolean; reportHash: Hex }>();
  sent: { key: string; paymentId: bigint; cleared: boolean; reportHash: Hex }[] = [];
  balance = BigInt(0);
  failNext?: Error;
  async self() {
    return SELF;
  }
  async treasuryAuditor() {
    return this.auditor;
  }
  treasuryAddress() {
    return "0x00000000000000000000000000000000000000c1" as Address;
  }
  async chainId() {
    return 42220;
  }
  async payment(id: bigint) {
    return this.onchain.get(id.toString()) ?? { vendor: zeroAddress, amount: BigInt(0), lineId: pad("0x", { size: 32 }), invoiceId: pad("0x", { size: 32 }), fileHash: pad("0x", { size: 32 }), status: "none" as const, approvals: BigInt(0) };
  }
  async paymentCount() {
    return BigInt(this.onchain.size);
  }
  async paymentAudit(id: bigint) {
    const v = this.verdicts.get(id.toString());
    return { status: v ? (v.cleared ? ("cleared" as const) : ("flagged" as const)) : ("none" as const), reportHash: v?.reportHash ?? pad("0x", { size: 32 }) };
  }
  async perTxCap() {
    return PER_TX_CAP;
  }
  async auditPayment(args: { key: string; paymentId: bigint; cleared: boolean; reportHash: Hex }) {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = undefined;
      throw e;
    }
    this.sent.push(args);
    this.verdicts.set(args.paymentId.toString(), { cleared: args.cleared, reportHash: args.reportHash });
    const p = this.onchain.get(args.paymentId.toString())!;
    const executed = args.cleared && p.amount <= PER_TX_CAP;
    if (executed) p.status = "executed";
    return { status: executed ? ("executed" as const) : ("recorded" as const), txHash: pad(toHex(700 + Number(args.paymentId)), { size: 32 }) };
  }
  async treasuryBalanceAt() {
    return this.balance;
  }
}

const QR_FILE: InvoiceFile = { bytes: new Uint8Array([1, 2, 3, 4]), mimeType: "image/png" };

async function auditorWorld() {
  const db = await createTestDb();
  const people = await seed(db);
  const tg = memoryNotifier();
  const chain = new FakeAuditorChain();
  const files = new Map<string, InvoiceFile>();
  const qrs = new Map<string, InvoiceFields | null>();
  const failingFiles = new Set<string>();
  const deps: AuditorDeps = {
    db,
    chain,
    notify: tg.notify,
    loadFile: async (url) => {
      if (failingFiles.has(url)) throw new Error("blob unavailable");
      return files.get(url)!;
    },
    readQr: async (file) => qrs.get(keccak256(file.bytes)) ?? null,
    now: () => NOW,
    appUrl: "https://coop.test",
  };

  let nextId = 1;
  /** A payment as the treasurer would have proposed it: invoice row, stored file, chain and index. */
  async function proposed(importe: string, opts: { nro?: number; withInvoice?: boolean; qr?: Partial<InvoiceFields> | null; at?: Date } = {}) {
    const id = BigInt(nextId++);
    const fields = invoiceFields({ importe, nro: BigInt(opts.nro ?? 1000 + Number(id)) });
    const bytes = new Uint8Array([...QR_FILE.bytes, Number(id)]);
    const fileHash = keccak256(bytes);
    const fileUrl = `https://files.test/${id}.png`;
    files.set(fileUrl, { bytes, mimeType: "image/png" });
    qrs.set(fileHash, opts.qr === null ? null : { ...fields, ...(opts.qr ?? {}) });
    const invoiceId = invoiceIdOf(fields);
    const amount = toWarsUnits(importe);
    if (opts.withInvoice !== false) {
      await db.insert(invoices).values({
        uploaderPersonId: people.tesorera.id,
        vendorId: people.vendor.id,
        status: "auditando",
        cuit: fields.cuit,
        tipo: fields.tipo,
        ptoVta: fields.ptoVta,
        nro: fields.nro,
        amount: amount.toString(),
        fileUrl,
        fileHash,
        lineId: LINE_MATERIALES,
        invoiceId,
        paymentId: id,
      });
    }
    const proposedTxHash = pad(toHex(100 + Number(id)), { size: 32 });
    await db.insert(payments).values({ paymentId: id, vendor: VENDOR_ADDRESS, amount: amount.toString(), lineId: LINE_MATERIALES, invoiceId, fileHash, status: "pending", proposedTxHash });
    await db.insert(chainEvents).values({ blockNumber: BigInt(10 + Number(id)), blockTime: opts.at ?? NOW, txHash: proposedTxHash, logIndex: 1, address: chain.treasuryAddress(), eventName: "PaymentProposed", args: {} });
    chain.onchain.set(id.toString(), { vendor: VENDOR_ADDRESS, amount, lineId: LINE_MATERIALES, invoiceId, fileHash, status: "pending", approvals: BigInt(0) });
    return { id, fileUrl };
  }
  return { db, people, tg, chain, deps, proposed, failingFiles };
}

describe("runAuditor", () => {
  test("does nothing when the treasury has no auditor, and warns the operator if the key is not the trusted one", async () => {
    const w = await auditorWorld();
    const [op] = await w.db.insert(persons).values({ name: "Op", phone: "+5493880000099", roles: ["operador"], telegramChatId: BigInt(99) }).returning();
    await w.proposed("4000.00");

    w.chain.auditor = zeroAddress;
    expect(await runAuditor(w.deps)).toEqual({ ok: true, skipped: "el tesoro no tiene auditor" });
    w.chain.auditor = "0x00000000000000000000000000000000000000d9";
    expect(await runAuditor(w.deps)).toMatchObject({ skipped: "la clave no es la del auditor del contrato" });
    expect(w.tg.to(op.id)[0].text).toContain("no es la que el contrato reconoce como auditor");
    expect(w.chain.sent).toEqual([]);
  });

  test("clears a clean payment with the hash of the report it stored", async () => {
    const w = await auditorWorld();
    const { id } = await w.proposed("4000.00");
    const out = await runAuditor(w.deps);
    expect(out).toMatchObject({ ok: true, audited: [{ paymentId: "1", verdict: "cleared", status: "executed" }], retry: 0 });

    const [row] = await w.db.select().from(audits).where(eq(audits.paymentId, id));
    expect(row.verdict).toBe("cleared");
    expect(row.findings).toEqual([expect.objectContaining({ code: "PROVEEDOR_NUEVO", level: "nota" })]);
    expect(w.chain.sent).toEqual([{ key: "audit:payment:1", paymentId: id, cleared: true, reportHash: keccak256(stringToBytes(row.reportJson)) }]);
    expect(JSON.parse(row.reportJson)).toMatchObject({ paymentId: "1", auditor: SELF, verdict: "cleared", payment: { amount: pesos(4000).toString() } });
    expect(w.tg.to(w.people.revisora.id)).toEqual([]);
  });

  test("flags a split purchase and tells the revisor once, with the report link", async () => {
    const w = await auditorWorld();
    await w.proposed("7000.00", { at: new Date(NOW.getTime() - 2 * DAY) });
    w.chain.onchain.get("1")!.status = "executed";
    await w.db.update(payments).set({ status: "executed" }).where(eq(payments.paymentId, BigInt(1)));
    const { id } = await w.proposed("6000.00");

    const out = await runAuditor(w.deps);
    expect(out).toMatchObject({ audited: [{ paymentId: "2", verdict: "flagged", status: "recorded" }] });
    expect(w.chain.sent.map((s) => [s.paymentId, s.cleared])).toEqual([[id, false]]);
    const msgs = w.tg.to(w.people.revisora.id);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toMatch(/^Auditor: revisé el pago #2 \(Factura C 0003-00001002 de Librería El Aula por \$ 6\.000,00\)/);
    expect(msgs[0].text).toContain("compra partida");
    expect(msgs[0].text).toContain("https://coop.test/auditoria/2");

    // Next round: the contract already has the verdict, nothing is sent again.
    await runAuditor(w.deps);
    expect(w.chain.sent).toHaveLength(1);
    expect(w.tg.to(w.people.revisora.id)).toHaveLength(1);
  });

  test("a payment with no invoice in the system is flagged", async () => {
    const w = await auditorWorld();
    await w.proposed("4000.00", { withInvoice: false });
    await runAuditor(w.deps);
    expect(w.chain.sent[0].cleared).toBe(false);
    const [row] = await w.db.select().from(audits);
    expect((row.findings as { code: string }[]).map((f) => f.code)).toContain("SIN_FACTURA");
  });

  test("if the file can't be loaded it waits for the next round instead of guessing", async () => {
    const w = await auditorWorld();
    const { fileUrl } = await w.proposed("4000.00");
    w.failingFiles.add(fileUrl);
    expect(await runAuditor(w.deps)).toMatchObject({ audited: [], retry: 1 });
    expect(await w.db.select().from(audits)).toEqual([]);
    w.failingFiles.clear();
    expect(await runAuditor(w.deps)).toMatchObject({ audited: [{ verdict: "cleared" }] });
  });

  test("a retry sends the verdict and hash it stored the first time", async () => {
    const w = await auditorWorld();
    await w.proposed("4000.00");
    const pending = new Error("in flight");
    pending.name = "AgentTxPendingError";
    w.chain.failNext = pending;
    expect(await runAuditor(w.deps)).toMatchObject({ audited: [{ status: "busy" }] });
    const [first] = await w.db.select().from(audits);
    await runAuditor(w.deps);
    expect(w.chain.sent).toEqual([expect.objectContaining({ reportHash: first.reportHash, cleared: true })]);
  });

  test("its sends wait for each other but never for the agent's", async () => {
    const w = await auditorWorld();
    await w.proposed("4000.00");
    const held = await withLock(w.db, AUDITOR_TX_LOCK, 60_000, async () => runAuditor(w.deps));
    expect(held).toMatchObject({ audited: [{ status: "busy" }] });
    const agentHeld = await withLock(w.db, "agent-tx", 60_000, async () => runAuditor(w.deps));
    expect(agentHeld).toMatchObject({ audited: [{ status: "executed" }] });
  });
});

describe("reconcileBalance", () => {
  async function withBooks(onchain: bigint) {
    const w = await auditorWorld();
    const [op] = await w.db.insert(persons).values({ name: "Op", phone: "+5493880000099", roles: ["operador"], telegramChatId: BigInt(99) }).returning();
    await w.db.insert(indexerCursor).values({ key: "treasury", blockNumber: BigInt(50) });
    await w.db.insert(contributions).values([
      { amount: pesos(10000).toString(), kind: "dinero", txHash: pad("0xc1", { size: 32 }), logIndex: 0, blockNumber: BigInt(20), occurredAt: NOW },
      { amount: pesos(500).toString(), kind: "especie", occurredAt: NOW },
    ]);
    await w.db.insert(payments).values({ paymentId: BigInt(9), vendor: VENDOR_ADDRESS, amount: pesos(3000).toString(), lineId: LINE_MATERIALES, invoiceId: pad("0x09", { size: 32 }), fileHash: pad("0x09", { size: 32 }), status: "executed" });
    w.chain.balance = onchain;
    return { ...w, op };
  }

  test("a balance that matches the books says nothing", async () => {
    const w = await withBooks(pesos(7000));
    expect(await reconcileBalance(w.deps)).toEqual({ ran: true, block: "50", onchain: pesos(7000).toString(), recorded: pesos(7000).toString(), matches: true });
    expect(w.tg.sent).toEqual([]);
  });

  test("a difference goes to the revisor and the operator, once a day", async () => {
    const w = await withBooks(pesos(6000));
    expect(await reconcileBalance(w.deps)).toMatchObject({ ran: true, matches: false });
    expect(w.tg.to(w.people.revisora.id)[0].text).toContain("el saldo del tesoro no cierra");
    expect(w.tg.to(w.people.revisora.id)[0].text).toContain("diferencia de $ 1.000,00");
    expect(w.tg.to(w.op.id)).toHaveLength(1);
    expect(await reconcileBalance(w.deps)).toEqual({ ran: false });
  });
});

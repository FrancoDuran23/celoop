// Test doubles for the agent: a captured Telegram, a fake invoice reader, a fake chain that
// behaves like the contract's auto-pay rule, a fake indexer and a seeded database. Tests only.
import { eq, sql } from "drizzle-orm";
import { keccak256, pad, toHex, type Address, type Hex } from "viem";
import type { Db } from "@/db";
import {
  budgetIndex,
  budgetLines,
  chainEvents,
  contributionIntents,
  contributions,
  cooperadora,
  payments,
  persons,
  vendors,
} from "@/db/schema";
import { createTestDb } from "@/db/testing";
import type { Buttons, Notifier } from "@/lib/bot/notify";
import { invoiceIdOf, type InvoiceFields, type ReadResult } from "@/lib/invoice";
import { closeReport } from "@/lib/report/lifecycle";
import type { AgentDeps, ChainPort, ReportsPort } from "./deps";
import { pesos } from "./format";

export const COOP_CUIT = BigInt("30712345678");
export const VENDOR_CUIT = BigInt("20111111112");
export const VENDOR_ADDRESS = "0x00000000000000000000000000000000000000b1" as Address;
export const LINE_MATERIALES = keccak256(toHex("materiales"));
export const LINE_MANTENIMIENTO = keccak256(toHex("mantenimiento"));
export const APP_URL = "https://coop.test";
export const PER_TX_CAP = pesos(10000);

export type Sent = { personId: number; text: string; buttons?: Buttons };

export function memoryNotifier(): { notify: Notifier; sent: Sent[]; to: (personId: number) => Sent[]; clear: () => void } {
  const sent: Sent[] = [];
  return {
    sent,
    notify: async (personId, text, buttons) => void sent.push({ personId, text, buttons }),
    to: (personId) => sent.filter((s) => s.personId === personId),
    clear: () => void sent.splice(0),
  };
}

/** Every URL in an inline keyboard. */
export function buttonUrls(buttons?: Buttons): string[] {
  if (!buttons || "menu" in buttons) return [];
  return buttons.flat().flatMap((b) => ("url" in b ? [b.url] : []));
}
export function buttonData(buttons?: Buttons): string[] {
  if (!buttons || "menu" in buttons) return [];
  return buttons.flat().flatMap((b) => ("data" in b ? [b.data] : []));
}

export function invoiceFields(over: Partial<InvoiceFields> = {}): InvoiceFields {
  return {
    cuit: VENDOR_CUIT,
    tipo: 11,
    ptoVta: 3,
    nro: BigInt(1234),
    importe: "4000.00",
    fecha: "2026-10-10",
    moneda: "PES",
    receptorDocTipo: 80,
    receptorDocNro: COOP_CUIT,
    cae: "75123456789012",
    ...over,
  };
}

/** Reader that returns whatever the test queued for the next file. */
export class FakeReader {
  next: ReadResult[] = [];
  read = async (): Promise<ReadResult> => {
    const r = this.next.shift();
    if (!r) throw new Error("FakeReader: nothing queued");
    return r;
  };
  queue(fields: InvoiceFields, raw: unknown = { qr: { ver: 1 } }) {
    this.next.push({ ok: true, fields, source: "qr", raw });
  }
}

/**
 * Pays on the spot under PER_TX_CAP (like the contract's auto rule), otherwise leaves it pending.
 * With `withAuditor`, every proposal waits (status "auditing") until the test calls audit().
 */
export class FakeChain implements ChainPort {
  withAuditor = false;
  /** On-chain state per payment id, as paymentState() reports it. */
  states = new Map<string, { status: "pending" | "executed" | "rejected"; audit: "none" | "cleared" | "flagged"; amount: bigint }>();
  /** Runs inside deps.auditNow in tests that wire it. */
  async audit(paymentId: bigint, cleared: boolean) {
    const st = this.states.get(paymentId.toString());
    if (!st || st.status !== "pending" || st.audit !== "none") return;
    st.audit = cleared ? "cleared" : "flagged";
    if (cleared && st.amount <= PER_TX_CAP) st.status = "executed";
  }
  async paymentState(paymentId: bigint) {
    const st = this.states.get(paymentId.toString());
    return { status: st?.status ?? ("none" as const), audit: st?.audit ?? ("none" as const) };
  }
  proposals: Array<{ key: string; amount: bigint; invoiceId: Hex; lineId: Hex; vendor: Address }> = [];
  sweeps: Array<{ key: string; ref: Hex; amount: bigint }> = [];
  paidInvoices = new Set<string>();
  balances = new Map<string, bigint>();
  results = new Map<string, unknown>();
  nextPaymentId = 1;
  /** Called when a box is swept, with what the indexer should later see. */
  onSweep?: (ref: Hex, amount: bigint, txHash: Hex) => void;
  failNextPropose?: Error;

  async proposePayment(args: Parameters<ChainPort["proposePayment"]>[0]) {
    if (this.failNextPropose) {
      const e = this.failNextPropose;
      this.failNextPropose = undefined;
      throw e;
    }
    const known = this.results.get(args.key);
    if (known) return known as Awaited<ReturnType<ChainPort["proposePayment"]>>;
    const invoiceId = invoiceIdOf(args.invoice);
    this.proposals.push({ key: args.key, amount: args.amount, invoiceId, lineId: args.lineId, vendor: args.vendor });
    const paymentId = BigInt(this.nextPaymentId++);
    const txHash = pad(toHex(1000 + Number(paymentId)), { size: 32 });
    if (this.withAuditor) {
      this.states.set(paymentId.toString(), { status: "pending", audit: "none", amount: args.amount });
      const result = { status: "auditing" as const, paymentId, txHash };
      this.results.set(args.key, result);
      return result;
    }
    const executed = args.amount <= PER_TX_CAP;
    if (executed) this.paidInvoices.add(invoiceId);
    this.states.set(paymentId.toString(), { status: executed ? "executed" : "pending", audit: "none", amount: args.amount });
    const result = { status: executed ? ("executed" as const) : ("pending" as const), paymentId, txHash };
    this.results.set(args.key, result);
    return result;
  }

  async sweepBox(args: { key: string; ref: Hex }) {
    const known = this.results.get(args.key);
    if (known) return known as Awaited<ReturnType<ChainPort["sweepBox"]>>;
    const box = await this.boxAddress(args.ref);
    const amount = this.balances.get(box.toLowerCase()) ?? BigInt(0);
    if (amount === BigInt(0)) return { status: "empty" as const, amount };
    this.balances.set(box.toLowerCase(), BigInt(0));
    const txHash = pad(toHex(5000 + this.sweeps.length), { size: 32 });
    this.sweeps.push({ key: args.key, ref: args.ref, amount });
    this.onSweep?.(args.ref, amount, txHash);
    const result = { status: "swept" as const, amount, txHash };
    this.results.set(args.key, result);
    return result;
  }

  async isInvoicePaid(invoiceId: Hex) {
    return this.paidInvoices.has(invoiceId);
  }
  async boxAddress(ref: Hex) {
    return `0x${keccak256(ref).slice(-40)}` as Address;
  }
  async balanceOf(address: Address) {
    return this.balances.get(address.toLowerCase()) ?? BigInt(0);
  }
  async treasuryBalance() {
    return null;
  }
  async deposit(ref: Hex, amount: bigint) {
    const box = await this.boxAddress(ref);
    this.balances.set(box.toLowerCase(), (this.balances.get(box.toLowerCase()) ?? BigInt(0)) + amount);
  }
}

/** Stands in for runIndexer: applies whatever events the test (or the fake chain) queued. */
export class FakeIndexer {
  queued: Array<(db: Db) => Promise<void>> = [];
  runs = 0;
  constructor(private db: Db) {}
  run = async () => {
    this.runs++;
    const work = this.queued.splice(0);
    for (const w of work) await w(this.db);
    return { events: work.length };
  };
  /** What the real indexer writes for a Contribution(ref, amount) log. */
  contribution(ref: Hex, amount: bigint, txHash: Hex, occurredAt: Date) {
    this.queued.push(async (db) => {
      const [intent] = await db.select().from(contributionIntents).where(sql`lower(${contributionIntents.ref}) = ${ref.toLowerCase()}`);
      await db.insert(contributions).values({
        ref: intent?.ref ?? ref,
        personId: intent?.personId ?? null,
        amount: amount.toString(),
        kind: "dinero",
        txHash,
        logIndex: 0,
        blockNumber: BigInt(10),
        occurredAt,
      });
      if (intent) await db.update(contributionIntents).set({ status: "swept", sweptTxHash: txHash }).where(eq(contributionIntents.ref, intent.ref));
    });
  }
  /** What the real indexer writes for PaymentExecuted / PaymentRejected. */
  payment(paymentId: bigint, status: "executed" | "rejected" | "pending", extra: Partial<typeof payments.$inferInsert> = {}) {
    this.queued.push(async (db) => {
      await db
        .insert(payments)
        .values({
          paymentId,
          vendor: VENDOR_ADDRESS,
          amount: pesos(1).toString(),
          lineId: LINE_MATERIALES,
          invoiceId: pad(toHex(Number(paymentId)), { size: 32 }),
          fileHash: pad("0x01", { size: 32 }),
          status,
          rule: status === "executed" ? "signers" : null,
          executedTxHash: status === "executed" ? pad(toHex(9000 + Number(paymentId)), { size: 32 }) : null,
          executedAt: status === "executed" ? new Date("2026-10-20T15:00:00Z") : null,
          ...extra,
        })
        .onConflictDoUpdate({ target: payments.paymentId, set: { status, ...extra } });
    });
  }
}

/** Reports port backed by module 05's real closeReport; publish is counted only. */
export function fakeReports(db: Db): ReportsPort & { closed: string[]; published: string[] } {
  const closed: string[] = [];
  const published: string[] = [];
  return {
    closed,
    published,
    async close(period) {
      closed.push(period);
      const { row, created } = await closeReport(db, period);
      return { status: row.status, created };
    },
    async publish(period) {
      published.push(period);
      return { ok: true, pdfUrl: `https://blob.test/${period}.pdf` };
    },
  };
}

export type Seed = Awaited<ReturnType<typeof seed>>;

/** Cooperadora, padrón (with Telegram chats), two budget lines, one vendor, threshold 2. */
export async function seed(db: Db) {
  await db.insert(cooperadora).values({
    name: "Cooperadora Escuela 12",
    school: "Escuela N° 12",
    cuit: COOP_CUIT,
    ruce: "RUCE-1",
    chainId: 42220,
    treasuryAddress: "0x00000000000000000000000000000000000000c1",
    boxFactoryAddress: "0x00000000000000000000000000000000000000c2",
    configHash: pad("0x09", { size: 32 }),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  const [socia, presidente, tesorera, secretario, revisora, proveedor] = await db
    .insert(persons)
    .values([
      { name: "Marta Gonzalez", phone: "+5493880000001", roles: ["socio"], telegramUserId: BigInt(1001), telegramChatId: BigInt(1001) },
      { name: "Raul Presidente", phone: "+5493880000002", roles: ["socio", "presidente"], safeAddress: "0x00000000000000000000000000000000000000a1", telegramUserId: BigInt(1002), telegramChatId: BigInt(1002) },
      { name: "Tere Tesorera", phone: "+5493880000003", roles: ["socio", "tesorero"], safeAddress: "0x00000000000000000000000000000000000000a2", telegramUserId: BigInt(1003), telegramChatId: BigInt(1003) },
      { name: "Sergio Secretario", phone: "+5493880000004", roles: ["secretario"], telegramUserId: BigInt(1004), telegramChatId: BigInt(1004) },
      { name: "Rita Revisora", phone: "+5493880000005", roles: ["socio", "revisor"], safeAddress: "0x00000000000000000000000000000000000000a3", telegramUserId: BigInt(1005), telegramChatId: BigInt(1005) },
      { name: "Libreria El Aula", phone: "+5493880000006", roles: ["proveedor"], telegramUserId: BigInt(1006), telegramChatId: BigInt(1006) },
    ])
    .returning();
  await db.insert(budgetLines).values([
    { lineId: LINE_MATERIALES, slug: "materiales", name: "Materiales" },
    { lineId: LINE_MANTENIMIENTO, slug: "mantenimiento", name: "Mantenimiento" },
  ]);
  await db.insert(budgetIndex).values([
    { lineId: LINE_MATERIALES, allocated: pesos(50000).toString(), spent: pesos(10000).toString(), periodEnd: 1_900_000_000 },
    { lineId: LINE_MANTENIMIENTO, allocated: pesos(20000).toString(), spent: "0", periodEnd: 1_900_000_000 },
  ]);
  const [vendor] = await db
    .insert(vendors)
    .values({ personId: proveedor.id, legalName: "Librería El Aula", cuit: VENDOR_CUIT, address: VENDOR_ADDRESS })
    .returning();
  await db.insert(chainEvents).values({
    blockNumber: BigInt(1),
    blockTime: new Date("2026-01-01T00:00:00Z"),
    txHash: pad("0xaa", { size: 32 }),
    logIndex: 0,
    address: "0x00000000000000000000000000000000000000c1",
    eventName: "SignersSet",
    args: { signers: ["0xa1", "0xa2", "0xa3"], threshold: "2" },
  });
  return { socia, presidente, tesorera, secretario, revisora, proveedor, vendor };
}

/** A fresh database, seeded, with every port faked. */
export async function testAgent(now = new Date("2026-10-14T15:00:00Z")) {
  const db = await createTestDb();
  const people = await seed(db);
  const tg = memoryNotifier();
  const chain = new FakeChain();
  const reader = new FakeReader();
  const indexer = new FakeIndexer(db);
  const reports = fakeReports(db);
  const clock = { now };
  const stored: string[] = [];
  const deps: AgentDeps = {
    db,
    notify: tg.notify,
    chain,
    readInvoice: reader.read,
    storeFile: async (name) => {
      stored.push(name);
      return `https://files.test/${name}`;
    },
    reports,
    indexer: indexer.run,
    now: () => clock.now,
    appUrl: APP_URL,
  };
  return { db, deps, people, tg, chain, reader, indexer, reports, clock, stored };
}

export const pdfFile = (seedByte = 1) => ({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, seedByte]), mimeType: "application/pdf" });

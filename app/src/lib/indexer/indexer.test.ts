import { eq } from "drizzle-orm";
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  keccak256,
  pad,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/db";
import {
  approvals,
  budgetIndex,
  chainEvents,
  contributionIntents,
  contributions,
  indexerCursor,
  payments,
  persons,
  proposals,
} from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { boxFactoryAbi, treasuryPolicyAbi } from "@/lib/chain/abi";
import { resetEnv } from "@/lib/env";
import { decodeProposalData, runIndexer, type IndexerSource, type RawLog } from "./index";

const TREASURY = "0x1111111111111111111111111111111111111111" as Address;
const FACTORY = "0x2222222222222222222222222222222222222222" as Address;
const WARS = "0x3333333333333333333333333333333333333333" as Address;
const BOX = "0x4444444444444444444444444444444444444444" as Address;
const STRANGER = "0x5555555555555555555555555555555555555555" as Address;
const VENDOR = "0x6666666666666666666666666666666666666666" as Address;
const SIGNER = "0x7777777777777777777777777777777777777777" as Address;
const SIGNER2 = "0x8888888888888888888888888888888888888888" as Address;

const b = (n: number) => BigInt(n);
const wars = (n: number) => BigInt(n) * BigInt(10) ** BigInt(18);
const line = (slug: string) => keccak256(toHex(slug));
const txh = (n: number) => pad(toHex(n), { size: 32 });

/** Encodes a log the way a node returns it: indexed args in topics, the rest in data. */
function makeLog(
  abi: Abi,
  address: Address,
  eventName: string,
  args: Record<string, unknown>,
  at: { block: number; tx: number; index: number },
): RawLog {
  const item = abi.find((x) => x.type === "event" && x.name === eventName);
  if (!item || item.type !== "event") throw new Error(`no event ${eventName}`);
  const topics = encodeEventTopics({ abi: [item], eventName, args } as never) as Hex[];
  const nonIndexed = item.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(
    nonIndexed,
    nonIndexed.map((i) => args[i.name!]),
  );
  return { address, blockNumber: b(at.block), transactionHash: txh(at.tx), logIndex: at.index, data, topics };
}

const treasuryLog = (name: string, args: Record<string, unknown>, at: { block: number; tx: number; index: number }) =>
  makeLog(treasuryPolicyAbi as Abi, TREASURY, name, args, at);
const transferLog = (from: Address, to: Address, value: bigint, at: { block: number; tx: number; index: number }) =>
  makeLog(erc20Abi as Abi, WARS, "Transfer", { from, to, value }, at);

class FakeSource implements IndexerSource {
  logs: RawLog[] = [];
  latest = b(100);
  budgets = new Map<Hex, { allocated: bigint; spent: bigint; periodEnd: bigint }>();
  getLogsCalls: [bigint, bigint][] = [];
  async addresses() {
    return { treasury: TREASURY, boxFactory: FACTORY, wars: WARS };
  }
  async latestBlock() {
    return this.latest;
  }
  async getLogs(from: bigint, to: bigint) {
    this.getLogsCalls.push([from, to]);
    return this.logs.filter((l) => l.blockNumber >= from && l.blockNumber <= to);
  }
  async blockTime(n: bigint) {
    return new Date(Number(n) * 1000);
  }
  async readBudget(lineId: Hex) {
    return this.budgets.get(lineId) ?? { allocated: b(0), spent: b(0), periodEnd: b(0) };
  }
}

let db: Db;
let source: FakeSource;
let personId: number;
const REF = pad(toHex(0xabc), { size: 32 });

beforeEach(async () => {
  resetEnv({ DEPLOY_BLOCK: "10" });
  db = await createTestDb();
  source = new FakeSource();
  [{ id: personId }] = await db
    .insert(persons)
    .values({ name: "Ana", phone: "+5493884000001", roles: ["socio"] })
    .returning({ id: persons.id });
  await db.insert(contributionIntents).values({ ref: REF, personId, boxAddress: BOX });
});

describe("contributions", () => {
  beforeEach(() => {
    source.logs = [
      // Box sweep: token Transfer, then Contribution, then BoxSwept, all in tx 1.
      transferLog(BOX, TREASURY, wars(5000), { block: 20, tx: 1, index: 0 }),
      treasuryLog("Contribution", { ref: REF, from: BOX, amount: wars(5000) }, { block: 20, tx: 1, index: 1 }),
      makeLog(boxFactoryAbi as Abi, FACTORY, "BoxSwept", { ref: REF, box: BOX, amount: wars(5000) }, {
        block: 20,
        tx: 1,
        index: 2,
      }),
      // Someone sends wARS straight to the treasury.
      transferLog(STRANGER, TREASURY, wars(700), { block: 30, tx: 2, index: 0 }),
      // contribute() with a ref nobody created.
      transferLog(STRANGER, TREASURY, wars(10), { block: 31, tx: 3, index: 4 }),
      treasuryLog("Contribution", { ref: txh(999), from: STRANGER, amount: wars(10) }, { block: 31, tx: 3, index: 5 }),
    ];
  });

  test("identified, unidentified and unknown-ref contributions", async () => {
    const result = await runIndexer(db, { source });
    expect(result).toEqual({ from: b(10), to: b(99), events: 6 });

    const rows = await db.select().from(contributions).orderBy(contributions.blockNumber);
    expect(rows.map((r) => [r.ref, r.personId, r.amount, Number(r.blockNumber)])).toEqual([
      [REF, personId, wars(5000).toString(), 20],
      [null, null, wars(700).toString(), 30],
      [txh(999), null, wars(10).toString(), 31],
    ]);
    expect(rows.every((r) => r.kind === "dinero")).toBe(true);
    expect(rows[0].occurredAt).toEqual(new Date(20_000));

    const [intent] = await db.select().from(contributionIntents).where(eq(contributionIntents.ref, REF));
    expect(intent.status).toBe("swept");
    expect(intent.sweptTxHash).toBe(txh(1));

    const events = await db.select().from(chainEvents).orderBy(chainEvents.blockNumber, chainEvents.logIndex);
    expect(events.map((e) => e.eventName)).toEqual([
      "Transfer",
      "Contribution",
      "BoxSwept",
      "Transfer",
      "Transfer",
      "Contribution",
    ]);
    expect(events[1].args).toEqual({ ref: REF, from: BOX, amount: wars(5000).toString() });
  });

  test("running twice over the same range writes nothing new", async () => {
    await runIndexer(db, { source });
    await db.delete(indexerCursor); // force a full replay from DEPLOY_BLOCK
    const again = await runIndexer(db, { source, maxBlocks: b(7) });
    expect(again.events).toBe(0);
    expect(await db.select().from(chainEvents)).toHaveLength(6);
    expect(await db.select().from(contributions)).toHaveLength(3);
  });

  test("a crash after the derived writes is replayed without duplicates", async () => {
    await runIndexer(db, { source });
    // Simulate a crash between the contribution insert and the chain_events insert.
    await db.delete(chainEvents);
    await db.delete(indexerCursor);
    const again = await runIndexer(db, { source });
    expect(again.events).toBe(6);
    expect(await db.select().from(contributions)).toHaveLength(3);
  });
});

describe("cursor", () => {
  test("starts at DEPLOY_BLOCK, stops at latest - 1 and walks in ranges", async () => {
    source.latest = b(30);
    source.logs = [
      transferLog(STRANGER, TREASURY, wars(1), { block: 29, tx: 1, index: 0 }),
      transferLog(STRANGER, TREASURY, wars(2), { block: 30, tx: 2, index: 0 }), // latest: not yet
    ];
    const first = await runIndexer(db, { source, maxBlocks: b(8) });
    expect(first).toEqual({ from: b(10), to: b(29), events: 1 });
    expect(source.getLogsCalls).toEqual([
      [b(10), b(17)],
      [b(18), b(25)],
      [b(26), b(29)],
    ]);
    const [cursor] = await db.select().from(indexerCursor);
    expect(cursor).toMatchObject({ key: "treasury", blockNumber: b(29) });

    expect(await runIndexer(db, { source })).toEqual({ from: b(30), to: b(29), events: 0 });

    source.latest = b(31);
    expect(await runIndexer(db, { source })).toEqual({ from: b(30), to: b(30), events: 1 });
    expect(await db.select().from(contributions)).toHaveLength(2);
  });

  test("asks for DEPLOY_BLOCK on the first run", async () => {
    resetEnv({ DEPLOY_BLOCK: "" });
    await expect(runIndexer(db, { source })).rejects.toThrow(/DEPLOY_BLOCK/);
  });
});

describe("payments and proposals", () => {
  const materiales = line("materiales");
  const comedor = line("comedor");
  const invoiceId = txh(0x1d);
  const fileHash = txh(0xf1);

  test("payments: automatic, escalated with approvals, rejected; budgets re-read", async () => {
    source.budgets.set(materiales, { allocated: wars(100_000), spent: wars(12_500), periodEnd: b(1_800_000_000) });
    const base = { vendor: VENDOR, lineId: materiales, invoiceId, fileHash };
    source.logs = [
      // Automatic: proposed and executed in the same tx.
      treasuryLog("PaymentProposed", { ...base, paymentId: b(1), amount: wars(12_500) }, { block: 40, tx: 1, index: 0 }),
      treasuryLog(
        "PaymentExecuted",
        { ...base, paymentId: b(1), amount: wars(12_500), rule: 0, overBudget: false, budgetExpired: false },
        { block: 40, tx: 1, index: 1 },
      ),
      // Escalated, then approved by two signers.
      treasuryLog("PaymentProposed", { ...base, paymentId: b(2), amount: wars(900_000) }, { block: 41, tx: 2, index: 0 }),
      treasuryLog("PaymentApproved", { paymentId: b(2), signer: SIGNER, approvals: b(1) }, { block: 42, tx: 3, index: 0 }),
      treasuryLog("PaymentApproved", { paymentId: b(2), signer: SIGNER2, approvals: b(2) }, { block: 43, tx: 4, index: 0 }),
      treasuryLog(
        "PaymentExecuted",
        { ...base, paymentId: b(2), amount: wars(900_000), rule: 1, overBudget: true, budgetExpired: false },
        { block: 43, tx: 4, index: 1 },
      ),
      // Escalated and rejected.
      treasuryLog("PaymentProposed", { ...base, paymentId: b(3), amount: wars(1) }, { block: 44, tx: 5, index: 0 }),
      treasuryLog("PaymentRejected", { paymentId: b(3), signer: SIGNER }, { block: 45, tx: 6, index: 0 }),
    ];
    await runIndexer(db, { source });

    const rows = await db.select().from(payments).orderBy(payments.paymentId);
    expect(rows.map((p) => [p.paymentId, p.status, p.rule, p.approvals, p.overBudget])).toEqual([
      [b(1), "executed", "auto", 0, false],
      [b(2), "executed", "signers", 2, true],
      [b(3), "rejected", null, 0, false],
    ]);
    expect(rows[0]).toMatchObject({
      vendor: VENDOR,
      amount: wars(12_500).toString(),
      lineId: materiales,
      invoiceId,
      fileHash,
      proposedTxHash: txh(1),
      executedTxHash: txh(1),
      executedAt: new Date(40_000),
    });

    const votes = await db.select().from(approvals).orderBy(approvals.id);
    expect(votes.map((v) => [v.target, v.targetId, v.signer])).toEqual([
      ["payment", b(2), SIGNER],
      ["payment", b(2), SIGNER2],
    ]);

    const [budget] = await db.select().from(budgetIndex);
    expect(budget).toMatchObject({
      lineId: materiales,
      allocated: wars(100_000).toString(),
      spent: wars(12_500).toString(),
      periodEnd: 1_800_000_000,
    });

    // A replay of the old proposal logs must not undo the executions.
    await db.delete(indexerCursor);
    await db.delete(chainEvents);
    await runIndexer(db, { source });
    const again = await db.select().from(payments).orderBy(payments.paymentId);
    expect(again.map((p) => p.status)).toEqual(["executed", "executed", "rejected"]);
    expect(await db.select().from(approvals)).toHaveLength(2);
  });

  test("proposals are decoded by kind and follow their votes", async () => {
    const reasonHash = keccak256(toHex("se rompió el termotanque"));
    const setBudget = encodeAbiParameters(
      [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
      [materiales, wars(100_000), b(1_800_000_000)],
    );
    const moveBudget = encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }],
      [comedor, materiales, wars(5_000), reasonHash],
    );
    const setSigners = encodeAbiParameters([{ type: "address[]" }, { type: "uint256" }], [[SIGNER, SIGNER2], b(2)]);
    source.budgets.set(materiales, { allocated: wars(105_000), spent: b(0), periodEnd: b(1_800_000_000) });
    source.budgets.set(comedor, { allocated: wars(45_000), spent: b(0), periodEnd: b(1_800_000_000) });
    source.logs = [
      treasuryLog("ProposalCreated", { proposalId: b(1), proposer: SIGNER, kind: 0, data: setBudget }, { block: 50, tx: 1, index: 0 }),
      treasuryLog("ProposalApproved", { proposalId: b(1), signer: SIGNER2, approvals: b(2) }, { block: 51, tx: 2, index: 0 }),
      treasuryLog("ProposalExecuted", { proposalId: b(1), kind: 0 }, { block: 51, tx: 2, index: 1 }),
      treasuryLog("BudgetSet", { lineId: materiales, allocated: wars(100_000), periodEnd: b(1_800_000_000) }, { block: 51, tx: 2, index: 2 }),
      treasuryLog("ProposalCreated", { proposalId: b(2), proposer: SIGNER, kind: 1, data: moveBudget }, { block: 52, tx: 3, index: 0 }),
      treasuryLog("ProposalCreated", { proposalId: b(3), proposer: SIGNER2, kind: 4, data: setSigners }, { block: 53, tx: 4, index: 0 }),
      treasuryLog("ProposalCreated", { proposalId: b(4), proposer: SIGNER2, kind: 7, data: "0x" }, { block: 54, tx: 5, index: 0 }),
      treasuryLog(
        "BudgetMoved",
        { fromLine: comedor, toLine: materiales, amount: wars(5_000), reasonHash },
        { block: 55, tx: 6, index: 0 },
      ),
    ];
    await runIndexer(db, { source });

    const rows = await db.select().from(proposals).orderBy(proposals.proposalId);
    expect(rows.map((p) => [p.proposalId, p.kind, p.status, p.approvals])).toEqual([
      [b(1), "SetBudget", "executed", 2],
      [b(2), "MoveBudget", "open", 1],
      [b(3), "SetSigners", "open", 1],
      [b(4), "Unpause", "open", 1],
    ]);
    expect(rows[0].decoded).toEqual({ lineId: materiales, allocated: wars(100_000).toString(), periodEnd: "1800000000" });
    expect(rows[1].decoded).toEqual({
      fromLine: comedor,
      toLine: materiales,
      amount: wars(5_000).toString(),
      reasonHash,
    });
    expect(rows[2].decoded).toEqual({ signers: [SIGNER, SIGNER2], threshold: "2" });
    expect(rows[3].decoded).toEqual({});
    expect(rows[0]).toMatchObject({ proposer: SIGNER, createdTxHash: txh(1), executedTxHash: txh(2), data: setBudget });

    const votes = await db.select().from(approvals);
    expect(votes.map((v) => [v.target, v.targetId, v.signer])).toEqual([["proposal", b(1), SIGNER2]]);

    const budgets = await db.select().from(budgetIndex).orderBy(budgetIndex.lineId);
    expect(Object.fromEntries(budgets.map((x) => [x.lineId, x.allocated]))).toEqual({
      [materiales]: wars(105_000).toString(),
      [comedor]: wars(45_000).toString(),
    });
  });

  test("every proposal kind decodes", () => {
    const vendor = encodeAbiParameters([{ type: "address" }, { type: "uint64" }, { type: "bool" }], [VENDOR, b(20111111112), true]);
    expect(decodeProposalData(2, vendor)).toEqual({ vendor: VENDOR, cuit: "20111111112", enabled: true });
    const caps = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [wars(50_000), wars(200_000)]);
    expect(decodeProposalData(3, caps)).toEqual({
      perTxCap: wars(50_000).toString(),
      vendorMonthlyCap: wars(200_000).toString(),
    });
    expect(decodeProposalData(5, encodeAbiParameters([{ type: "address" }], [SIGNER]))).toEqual({ agent: SIGNER });
    expect(decodeProposalData(6, txh(7))).toEqual({ configHash: txh(7) });
    expect(decodeProposalData(9, "0x")).toEqual({ error: "unknown kind 9" });
    expect(decodeProposalData(0, "0x1234")).toHaveProperty("error");
  });
});

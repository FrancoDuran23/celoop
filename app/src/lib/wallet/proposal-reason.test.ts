import { encodeAbiParameters, encodeEventTopics, type Hex, type TransactionReceipt } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { createTestDb, ensureCooperadora } from "@/db/testing";
import { budgetLines, proposals, vendors } from "@/db/schema";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { applyExecutedProposal, recordProposal, recordProposalReason } from "./proposal-reason";
import { lineIdOf } from "./proposal-builder";
import { encodeMoveBudget, encodeSetBudget, encodeSetVendor } from "./proposals";
import { SIGNER_SAFE, TREASURY, VENDOR_SAFE, seedLink, seedPerson, seedVendor } from "./testing/fixtures";

const TX = `0x${"ab".repeat(32)}` as Hex;
const FROM = `0x${"01".repeat(32)}` as Hex;
const TO = `0x${"02".repeat(32)}` as Hex;

function receiptWith(proposer: `0x${string}`, data: Hex, kind = 1): TransactionReceipt {
  const topics = encodeEventTopics({ abi: treasuryPolicyAbi, eventName: "ProposalCreated", args: { proposalId: BigInt(4), proposer } });
  const logData = encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [kind, data]);
  return {
    logs: [{ address: TREASURY, topics, data: logData, blockNumber: BigInt(1), transactionHash: TX, logIndex: 0, blockHash: TX, transactionIndex: 0, removed: false }],
  } as unknown as TransactionReceipt;
}

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await ensureCooperadora(db);
}, 60_000);

describe("recordProposalReason", () => {
  it("stores the motive when it matches the hash in the proposal", async () => {
    const person = await seedPerson(db, { safe: SIGNER_SAFE });
    const token = await seedLink(db, person.id, "sign", { action: "propose" });
    const data = encodeMoveBudget({ fromLine: FROM, toLine: TO, amount: BigInt(1), reasonText: "rotura de caño" });
    const chain = { receipt: async () => receiptWith(SIGNER_SAFE, data) };
    const r = await recordProposalReason({ token, txHash: TX, reasonText: "rotura de caño" }, { db, chain, treasury: TREASURY });
    expect(r).toEqual({ ok: true, proposalId: "4" });
    const [row] = await db.select().from(proposals);
    expect(row).toMatchObject({ kind: "MoveBudget", reasonText: "rotura de caño", proposer: SIGNER_SAFE, createdTxHash: TX });
  });

  it("only fills in the motive if the indexer already wrote the row", async () => {
    const person = await seedPerson(db, { safe: SIGNER_SAFE });
    const token = await seedLink(db, person.id, "sign");
    const data = encodeMoveBudget({ fromLine: FROM, toLine: TO, amount: BigInt(1), reasonText: "pintura" });
    await db.insert(proposals).values({ proposalId: BigInt(4), kind: "MoveBudget", data, proposer: SIGNER_SAFE, approvals: 2 });
    const chain = { receipt: async () => receiptWith(SIGNER_SAFE, data) };
    await recordProposalReason({ token, txHash: TX, reasonText: "pintura" }, { db, chain, treasury: TREASURY });
    const [row] = await db.select().from(proposals);
    expect(row).toMatchObject({ approvals: 2, reasonText: "pintura" });
  });

  it("rejects a motive that doesn't match, or a proposal by someone else", async () => {
    const person = await seedPerson(db, { safe: SIGNER_SAFE });
    const token = await seedLink(db, person.id, "sign");
    const data = encodeMoveBudget({ fromLine: FROM, toLine: TO, amount: BigInt(1), reasonText: "pintura" });
    const mine = { receipt: async () => receiptWith(SIGNER_SAFE, data) };
    expect((await recordProposalReason({ token, txHash: TX, reasonText: "otra" }, { db, chain: mine, treasury: TREASURY })).ok).toBe(false);
    const theirs = { receipt: async () => receiptWith(VENDOR_SAFE, data) };
    expect((await recordProposalReason({ token, txHash: TX, reasonText: "pintura" }, { db, chain: theirs, treasury: TREASURY })).ok).toBe(false);
    expect(await db.select().from(proposals)).toHaveLength(0);
  });
});

describe("new budget lines and vendors", () => {
  const VENDOR = "0x4444444444444444444444444444444444444444" as const;

  it("adds the budget_lines row for a new line once ProposalCreated is confirmed", async () => {
    const person = await seedPerson(db, { safe: SIGNER_SAFE });
    const token = await seedLink(db, person.id, "sign");
    const lineId = lineIdOf("biblioteca");
    const data = encodeSetBudget({ lineId, allocated: BigInt(5), periodEnd: BigInt(1830000000) });
    const chain = { receipt: async () => receiptWith(SIGNER_SAFE, data, 0) };
    const r = await recordProposal({ token, txHash: TX, newLine: { slug: "biblioteca", name: "Biblioteca" } }, { db, chain, treasury: TREASURY });
    expect(r.ok).toBe(true);
    expect(await db.select().from(budgetLines)).toEqual([{ cooperadoraId: 1, lineId, slug: "biblioteca", name: "Biblioteca" }]);
    const wrong = await recordProposal({ token, txHash: TX, newLine: { slug: "otra", name: "Otra" } }, { db, chain, treasury: TREASURY });
    expect(wrong.ok).toBe(false);
  });

  it("keeps the vendor's legal name pending, then writes vendors when the proposal executes", async () => {
    const proposer = await seedPerson(db, { safe: SIGNER_SAFE });
    const vendorPerson = await seedPerson(db, { name: "Beto", safe: VENDOR, roles: ["proveedor"] });
    const token = await seedLink(db, proposer.id, "sign", { action: "propose" });
    const data = encodeSetVendor({ vendor: VENDOR, cuit: BigInt(30500010912), enabled: true });
    // The indexer got there first with its own decoded args.
    await db.insert(proposals).values({ proposalId: BigInt(4), kind: "SetVendor", data, decoded: { vendor: VENDOR }, proposer: SIGNER_SAFE });
    const chain = { receipt: async () => receiptWith(SIGNER_SAFE, data, 2) };
    expect((await recordProposal({ token, txHash: TX, vendorLegalName: "Ferretería SRL" }, { db, chain, treasury: TREASURY })).ok).toBe(true);
    const [row] = await db.select().from(proposals);
    expect(row.decoded).toEqual({ vendor: VENDOR, meta: { vendorLegalName: "Ferretería SRL" } });

    const pending = { proposal: async () => ({ kind: 2, data, proposer: SIGNER_SAFE, executed: false, approvals: BigInt(1) }) };
    expect(await applyExecutedProposal(db, pending, BigInt(4))).toEqual({ applied: false });
    expect(await db.select().from(vendors)).toHaveLength(0);

    const executed = { proposal: async () => ({ kind: 2, data, proposer: SIGNER_SAFE, executed: true, approvals: BigInt(2) }) };
    expect(await applyExecutedProposal(db, executed, BigInt(4))).toEqual({ applied: true });
    const [vendor] = await db.select().from(vendors);
    expect(vendor).toMatchObject({ legalName: "Ferretería SRL", cuit: BigInt(30500010912), address: VENDOR, enabled: true, personId: vendorPerson.id });
  });

  it("disabling an existing vendor updates its row", async () => {
    await seedVendor(db, { address: VENDOR, legalName: "Ferretería SRL", cuit: BigInt(30500010912) });
    const data = encodeSetVendor({ vendor: VENDOR, cuit: BigInt(30500010912), enabled: false });
    const executed = { proposal: async () => ({ kind: 2, data, proposer: SIGNER_SAFE, executed: true, approvals: BigInt(2) }) };
    await applyExecutedProposal(db, executed, BigInt(9));
    const rows = await db.select().from(vendors);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ legalName: "Ferretería SRL", enabled: false });
  });
});

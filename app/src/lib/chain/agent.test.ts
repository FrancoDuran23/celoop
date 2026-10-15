// agent_txs state machine against a real anvil (no contracts needed: plain calls to an address).
import { eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/db";
import { agentTxs } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { resetEnv } from "@/lib/env";
import { parseTransaction } from "viem/celo";
import { AgentTxPendingError, sendAgentTx, signAgentTx, STALE_SENDING_MS } from "./agent";
import { ANVIL_KEYS, anvilAvailable, anvilRpc, startAnvil, type Anvil } from "./anvil";
import { readAttribution, withAttribution } from "./attribution";
import { publicClient } from "./clients";

const hasAnvil = anvilAvailable();
const AGENT = privateKeyToAccount(ANVIL_KEYS[1]);
const TARGET = "0x00000000000000000000000000000000000c0de1" as Address;
const DATA = "0xdeadbeef" as Hex;
/** PUSH1 0 PUSH1 0 REVERT */
const REVERTING_CODE = "0x60006000fd";
/** STOP */
const OK_CODE = "0x00";

describe.skipIf(!hasAnvil)("sendAgentTx (anvil)", () => {
  let anvil: Anvil;
  let db: Db;

  const nonces = async () => {
    const c = publicClient();
    return {
      latest: await c.getTransactionCount({ address: AGENT.address, blockTag: "latest" }),
      pending: await c.getTransactionCount({ address: AGENT.address, blockTag: "pending" }),
    };
  };
  const row = async (key: string) => (await db.select().from(agentTxs).where(eq(agentTxs.key, key)))[0];

  beforeAll(async () => {
    anvil = await startAnvil();
  });
  afterAll(async () => {
    await anvil?.stop();
  });

  beforeEach(async () => {
    resetEnv({
      CHAIN: "local",
      RPC_URL: anvil.url,
      AGENT_PRIVATE_KEY: ANVIL_KEYS[1],
      AGENT_SEND: "on",
      ATTRIBUTION_CODE: "celo_test_tag",
      FEE_CURRENCY: "",
    });
    db = await createTestDb();
    await anvilRpc(anvil.url, "evm_setAutomine", [true]);
    await anvilRpc(anvil.url, "anvil_setCode", [TARGET, OK_CODE]);
  });

  test("sends once, tagged, and returns the stored result for the same key", async () => {
    const before = await nonces();
    const first = await sendAgentTx({ key: "k:once", kind: "other", to: TARGET, data: DATA }, { db });
    if ("dryRun" in first) throw new Error("expected a send");
    expect(first.receipt.status).toBe("success");

    const tx = await publicClient().getTransaction({ hash: first.txHash });
    expect(tx.input.startsWith(DATA)).toBe(true);
    expect(readAttribution(tx.input)).toEqual(["celo_test_tag"]);

    expect(await row("k:once")).toMatchObject({
      status: "mined",
      kind: "other",
      txHash: first.txHash,
      nonce: before.pending,
      error: null,
    });

    const second = await sendAgentTx({ key: "k:once", kind: "other", to: TARGET, data: DATA }, { db });
    expect(second).toMatchObject({ txHash: first.txHash });
    expect((await nonces()).latest).toBe(before.latest + 1);
  });

  test("dry run simulates, writes nothing and sends nothing", async () => {
    resetEnv({ AGENT_SEND: "off" });
    const before = await nonces();
    expect(await sendAgentTx({ key: "k:dry", kind: "other", to: TARGET, data: DATA }, { db })).toEqual({
      dryRun: true,
    });
    expect(await row("k:dry")).toBeUndefined();
    expect(await nonces()).toEqual(before);

    // The simulation still catches a call that would revert.
    await anvilRpc(anvil.url, "anvil_setCode", [TARGET, REVERTING_CODE]);
    await expect(sendAgentTx({ key: "k:dry", kind: "other", to: TARGET, data: DATA }, { db })).rejects.toThrow();
    expect(await row("k:dry")).toBeUndefined();
  });

  test("a pending receipt is waited on, never resent", async () => {
    await anvilRpc(anvil.url, "evm_setAutomine", [false]);
    const before = await nonces();
    const args = { key: "k:pending", kind: "other", to: TARGET, data: DATA };

    const err = await sendAgentTx(args, { db, receiptTimeoutMs: 300 }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentTxPendingError);
    const stored = await row("k:pending");
    expect(stored.status).toBe("sending");
    expect(stored.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    // Same key again while it is in the mempool: still waiting, no second transaction.
    await expect(sendAgentTx(args, { db, receiptTimeoutMs: 300 })).rejects.toBeInstanceOf(AgentTxPendingError);
    expect(await nonces()).toEqual({ latest: before.latest, pending: before.pending + 1 });

    await anvilRpc(anvil.url, "evm_mine");
    const done = await sendAgentTx(args, { db });
    expect(done).toMatchObject({ txHash: stored.txHash });
    expect((await row("k:pending")).status).toBe("mined");
    expect(await nonces()).toEqual({ latest: before.latest + 1, pending: before.latest + 1 });
  });

  test("a sending row without a hash is retried only when stale and nothing is pending", async () => {
    const args = { key: "k:retry", kind: "propose", to: TARGET, data: DATA };
    await db.insert(agentTxs).values({ key: args.key, kind: args.kind, status: "sending", updatedAt: new Date() });

    // Fresh: another process may be sending it.
    await expect(sendAgentTx(args, { db })).rejects.toBeInstanceOf(AgentTxPendingError);

    // Stale, but the agent has something else in the mempool.
    const old = new Date(Date.now() - STALE_SENDING_MS - 1000);
    await db.update(agentTxs).set({ updatedAt: old }).where(eq(agentTxs.key, args.key));
    await anvilRpc(anvil.url, "evm_setAutomine", [false]);
    await sendAgentTx({ key: "k:other", kind: "other", to: TARGET, data: "0x01" }, { db, receiptTimeoutMs: 200 }).catch(
      () => {},
    );
    await expect(sendAgentTx(args, { db })).rejects.toThrow(/pending in the mempool/);
    expect((await row(args.key)).txHash).toBeNull();

    // Mempool empty again: now it is retried and mined.
    await anvilRpc(anvil.url, "evm_mine");
    await anvilRpc(anvil.url, "evm_setAutomine", [true]);
    const result = await sendAgentTx(args, { db });
    if ("dryRun" in result) throw new Error("expected a send");
    expect(await row(args.key)).toMatchObject({ status: "mined", txHash: result.txHash });
  });

  test("a failed simulation is recorded and retried on the next call", async () => {
    const args = { key: "k:fail", kind: "other", to: TARGET, data: DATA };
    await anvilRpc(anvil.url, "anvil_setCode", [TARGET, REVERTING_CODE]);
    const before = await nonces();
    await expect(sendAgentTx(args, { db })).rejects.toThrow();
    expect(await row(args.key)).toMatchObject({ status: "failed", txHash: null });
    expect((await row(args.key)).error).toMatch(/^simulation:/);
    expect(await nonces()).toEqual(before);

    await anvilRpc(anvil.url, "anvil_setCode", [TARGET, OK_CODE]);
    const result = await sendAgentTx(args, { db });
    expect(result).toHaveProperty("txHash");
    expect(await row(args.key)).toMatchObject({ status: "mined", error: null });
  });

  test("with FEE_CURRENCY the agent signs a CIP-64 transaction paying fees in that token", async () => {
    // anvil cannot execute CIP-64 (type 0x7b), so this checks the signed bytes instead of a receipt.
    const usdtAdapter = "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72";
    resetEnv({ FEE_CURRENCY: usdtAdapter });
    const data = withAttribution(DATA);
    const { serialized } = await signAgentTx({ to: TARGET, data });
    expect(serialized.startsWith("0x7b")).toBe(true);
    const tx = parseTransaction(serialized);
    expect(tx).toMatchObject({ type: "cip64", feeCurrency: usdtAdapter.toLowerCase(), to: TARGET, data, chainId: 31337 });
    expect(readAttribution(tx.data!)).toEqual(["celo_test_tag"]);

    resetEnv({ FEE_CURRENCY: "" });
    const plain = parseTransaction((await signAgentTx({ to: TARGET, data })).serialized);
    expect(plain.type).toBe("eip1559");
    expect("feeCurrency" in plain && plain.feeCurrency).toBeFalsy();
  });
});

test.skipIf(hasAnvil)("sendAgentTx (anvil) — skipped: `mise exec -- anvil` is not available", () => {});

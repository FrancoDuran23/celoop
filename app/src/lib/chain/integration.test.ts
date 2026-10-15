// End to end against anvil with the real contracts from module 01 (contracts/out).
// Box contribution → sweepBox → indexer → contributions row; proposePayment automatic and escalated.
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  erc20Abi,
  http,
  keccak256,
  toHex,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Db } from "@/db";
import { agentTxs, budgetIndex, contributionIntents, contributions, payments, persons } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { resetEnv } from "@/lib/env";
import { runIndexer } from "@/lib/indexer";
import { treasuryPolicyAbi } from "./abi";
import { proposePayment, sweepBox } from "./agent";
import { ANVIL_KEYS, anvilAvailable, anvilRpc, REPO_ROOT, startAnvil, type Anvil } from "./anvil";
import { readAttribution } from "./attribution";
import { publicClient } from "./clients";
import { boxAddress, getPayment, getTreasuryState, isInvoicePaid, vendorSpentThisPeriod, warsBalanceOf } from "./treasury";

const OUT = path.join(REPO_ROOT, "contracts/out");
const ARTIFACTS = {
  wars: "MockWARS.sol/MockWARS.json",
  treasury: "TreasuryPolicy.sol/TreasuryPolicy.json",
  factory: "BoxFactory.sol/BoxFactory.json",
};
const missing = Object.values(ARTIFACTS).filter((f) => !fs.existsSync(path.join(OUT, f)));
const hasAnvil = anvilAvailable();
const skipReason = !hasAnvil
  ? "`mise exec -- anvil` is not available"
  : missing.length > 0
    ? `module 01 contracts are not compiled yet (missing contracts/out/${missing.join(", ")}; run forge build)`
    : null;

function artifact(file: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(fs.readFileSync(path.join(OUT, file), "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

const wars = (n: number) => BigInt(n) * BigInt(10) ** BigInt(18);
const MATERIALES = keccak256(toHex("materiales"));
const VENDOR_CUIT = BigInt(20111111112);
const CODE = "celo_integration";

describe.skipIf(skipReason !== null)("chain module against anvil + module 01 contracts", () => {
  const signer = privateKeyToAccount(ANVIL_KEYS[0]);
  const agent = privateKeyToAccount(ANVIL_KEYS[1]);
  const signer2 = privateKeyToAccount(ANVIL_KEYS[2]);
  const vendor = privateKeyToAccount(ANVIL_KEYS[3]);
  const payer = privateKeyToAccount(ANVIL_KEYS[4]);

  let anvil: Anvil;
  let db: Db;
  let treasury: Address;
  let factory: Address;
  let token: Address;
  let personId: number;
  const ref = keccak256(toHex("intent-1"));

  beforeAll(async () => {
    anvil = await startAnvil();
    const chain = { ...foundry, rpcUrls: { default: { http: [anvil.url] } } };
    const pub = createPublicClient({ chain, transport: http(anvil.url) });
    const as = (account: typeof signer) => createWalletClient({ account, chain, transport: http(anvil.url) });
    const deploy = async (file: string, args: unknown[]) => {
      const { abi, bytecode } = artifact(file);
      const hash = await as(signer).deployContract({ abi, bytecode, args });
      const receipt = await pub.waitForTransactionReceipt({ hash });
      return { address: receipt.contractAddress!, block: receipt.blockNumber };
    };

    token = (await deploy(ARTIFACTS.wars, [])).address;
    const t = await deploy(ARTIFACTS.treasury, [
      token,
      [signer.address, signer2.address],
      BigInt(1),
      agent.address,
      wars(50_000),
      wars(200_000),
      keccak256(toHex("acta")),
      zeroAddress, // no auditor: automatic payments go out on proposal
    ]);
    treasury = t.address;
    factory = (await deploy(ARTIFACTS.factory, [treasury, token])).address;

    // Setup by the signers (threshold 1: proposals execute at once). This is test scaffolding,
    // not an agent transaction, so it does not go through sendAgentTx.
    const propose = async (kind: number, data: Hex) => {
      const hash = await as(signer).writeContract({
        address: treasury,
        abi: treasuryPolicyAbi,
        functionName: "propose",
        args: [kind, data],
      });
      await pub.waitForTransactionReceipt({ hash });
    };
    await propose(
      2,
      encodeAbiParameters([{ type: "address" }, { type: "uint64" }, { type: "bool" }], [vendor.address, VENDOR_CUIT, true]),
    );
    await propose(
      0,
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
        [MATERIALES, wars(100_000), BigInt(4_000_000_000)],
      ),
    );

    resetEnv({
      CHAIN: "local",
      RPC_URL: anvil.url,
      AGENT_PRIVATE_KEY: ANVIL_KEYS[1],
      AGENT_SEND: "on",
      ATTRIBUTION_CODE: CODE,
      FEE_CURRENCY: "",
      TREASURY_ADDRESS: treasury,
      BOX_FACTORY_ADDRESS: factory,
      WARS_ADDRESS: token,
      DEPLOY_BLOCK: t.block.toString(),
    });

    db = await createTestDb();
    [{ id: personId }] = await db
      .insert(persons)
      .values({ name: "Ana", phone: "+5493884000001", roles: ["socio"] })
      .returning({ id: persons.id });
    await db.insert(contributionIntents).values({ ref, personId, boxAddress: await boxAddress(ref) });

    // Payer gets wARS (stands in for the Ripio on-ramp).
    const mint = await as(payer).writeContract({
      address: token,
      abi: [...erc20Abi, ...artifact(ARTIFACTS.wars).abi] as Abi,
      functionName: "mint",
      args: [payer.address, wars(1_000_000)],
    });
    await pub.waitForTransactionReceipt({ hash: mint });
  }, 120_000);

  afterAll(async () => {
    await anvil?.stop();
  });

  const payerTransfer = async (to: Address, amount: bigint) => {
    const wallet = createWalletClient({
      account: payer,
      chain: { ...foundry, rpcUrls: { default: { http: [anvil.url] } } },
      transport: http(anvil.url),
    });
    const hash = await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "transfer", args: [to, amount] });
    await publicClient().waitForTransactionReceipt({ hash });
  };

  const expectTagged = async (txHash: Hex) => {
    const tx = await publicClient().getTransaction({ hash: txHash });
    expect(readAttribution(tx.input)).toEqual([CODE]);
  };

  test("box contribution: sweepBox, then the indexer credits the person", async () => {
    expect(await sweepBox({ key: `sweep:${ref}`, ref }, { db })).toEqual({ status: "empty", amount: BigInt(0) });
    expect(await db.select().from(agentTxs)).toHaveLength(0);

    const box = await boxAddress(ref);
    await payerTransfer(box, wars(15_000));
    await payerTransfer(treasury, wars(300)); // direct, unidentified

    const swept = await sweepBox({ key: `sweep:${ref}`, ref }, { db });
    expect(swept).toMatchObject({ status: "swept", amount: wars(15_000) });
    await expectTagged(swept.txHash!);
    expect(await warsBalanceOf(box)).toBe(BigInt(0));

    // Same key again: stored result, nothing new sent.
    expect(await sweepBox({ key: `sweep:${ref}`, ref }, { db })).toMatchObject({ status: "swept", txHash: swept.txHash });

    await anvilRpc(anvil.url, "evm_mine"); // the indexer stops at latest - 1
    const indexed = await runIndexer(db);
    expect(indexed.events).toBeGreaterThan(0);

    const rows = await db.select().from(contributions).orderBy(contributions.id);
    expect(rows.map((r) => [r.ref, r.personId, r.amount])).toEqual([
      [null, null, wars(300).toString()],
      [ref, personId, wars(15_000).toString()],
    ]);
    const [intent] = await db.select().from(contributionIntents).where(eq(contributionIntents.ref, ref));
    expect(intent).toMatchObject({ status: "swept", sweptTxHash: swept.txHash });

    // A second run over nothing new adds nothing.
    await runIndexer(db);
    expect(await db.select().from(contributions)).toHaveLength(2);
  });

  test("proposePayment: automatic and escalated", async () => {
    const fileHash = keccak256(toHex("factura.pdf"));
    const auto = await proposePayment(
      {
        key: "propose:invoice:1",
        vendor: vendor.address,
        invoice: { cuit: VENDOR_CUIT, tipo: 11, ptoVta: 1, nro: BigInt(1) },
        amount: wars(12_500),
        lineId: MATERIALES,
        fileHash,
      },
      { db },
    );
    expect(auto).toMatchObject({ status: "executed", paymentId: BigInt(1) });
    await expectTagged(auto.txHash!);
    expect(await warsBalanceOf(vendor.address)).toBe(wars(12_500));
    expect(await vendorSpentThisPeriod(vendor.address)).toBe(wars(12_500));

    const big = await proposePayment(
      {
        key: "propose:invoice:2",
        vendor: vendor.address,
        invoice: { cuit: VENDOR_CUIT, tipo: 11, ptoVta: 1, nro: BigInt(2) },
        amount: wars(60_000), // over perTxCap
        lineId: MATERIALES,
        fileHash,
      },
      { db },
    );
    expect(big).toMatchObject({ status: "pending", paymentId: BigInt(2) });
    await expectTagged(big.txHash!);
    expect((await getPayment(BigInt(2))).status).toBe("pending");

    // Idempotent by key: same answer, no second payment.
    const again = await proposePayment(
      {
        key: "propose:invoice:1",
        vendor: vendor.address,
        invoice: { cuit: VENDOR_CUIT, tipo: 11, ptoVta: 1, nro: BigInt(1) },
        amount: wars(12_500),
        lineId: MATERIALES,
        fileHash,
      },
      { db },
    );
    expect(again).toEqual(auto);
    expect(await warsBalanceOf(vendor.address)).toBe(wars(12_500));

    await anvilRpc(anvil.url, "evm_mine");
    await runIndexer(db);
    const rows = await db.select().from(payments).orderBy(payments.paymentId);
    expect(rows.map((p) => [p.paymentId, p.status, p.rule])).toEqual([
      [BigInt(1), "executed", "auto"],
      [BigInt(2), "pending", null],
    ]);
    const [budget] = await db.select().from(budgetIndex).where(eq(budgetIndex.lineId, MATERIALES));
    expect(budget).toMatchObject({ allocated: wars(100_000).toString(), spent: wars(12_500).toString() });

    const state = await getTreasuryState();
    expect(state).toMatchObject({
      balance: wars(15_300 - 12_500),
      paused: false,
      perTxCap: wars(50_000),
      vendorMonthlyCap: wars(200_000),
      threshold: BigInt(1),
      agent: agent.address,
      signers: [signer.address, signer2.address],
    });
    expect(state.budgets).toEqual([
      { lineId: MATERIALES, allocated: wars(100_000), spent: wars(12_500), periodEnd: BigInt(4_000_000_000) },
    ]);
    const invoiceId = keccak256(
      encodeAbiParameters(
        [{ type: "uint64" }, { type: "uint16" }, { type: "uint32" }, { type: "uint64" }],
        [VENDOR_CUIT, 11, 1, BigInt(1)],
      ),
    );
    expect(await isInvoicePaid(invoiceId)).toBe(true);
  });
});

test.skipIf(skipReason === null)(`integration against anvil — skipped: ${skipReason}`, () => {});

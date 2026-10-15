// E2E against an anvil fork of Celo mainnet, which already has Safe 1.4.1, Safe4337Module, the
// WebAuthn shared signer, the P-256 verifier and EntryPoint v0.7.
//
// A virtual passkey (a P-256 key generated in the test, answering like navigator.credentials.get)
// enrolls through registerPasskey. The real TreasuryPolicy is deployed locally (contracts/out) with
// that Safe as one of three signers, threshold 2. The agent proposes a payment over the automatic
// cap, a second signer approves, and the passkey Safe gives the last approval: the UserOperation is
// built and signed by the same sendSafeCalls the page uses, goes through handleBundlerRpc (link,
// policy, tag) and runs through EntryPoint.handleOps from a local stand-in for the bundler.
// Not covered: Pimlico's paymaster (the Safe prefunds its own gas here).
// Needs network access to forno.celo.org. Skip with SKIP_FORK_E2E=1.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  parseEther,
  stringToBytes,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { createTestDb } from "@/db/testing";
import { signLinks } from "@/db/schema";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { attributionSuffix } from "@/lib/chain/attribution";
import { ANVIL_KEYS, REPO_ROOT, anvilAvailable, startAnvil, type Anvil } from "@/lib/chain/anvil";
import { passkeySafeAddress } from "./account";
import { dbLookups, handleBundlerRpc, httpForward, type BundlerDeps } from "./bundler";
import { ENTRY_POINT } from "./constants";
import { registerPasskey } from "./enroll";
import { createMemoryRateLimiter } from "./rate-limit";
import { sendSafeCalls } from "./send";
import { approveData, seedLink, seedPerson, userOp } from "./testing/fixtures";
import { localBundler, waitMined } from "./testing/local-bundler";
import { createVirtualPasskey } from "./testing/virtual-passkey";

const FORK_URL = process.env.CELO_FORK_URL ?? "https://forno.celo.org";
// Pinned so anvil caches the forked state on disk (~/.foundry/cache/rpc): after the first run the
// test barely touches forno, which rate-limits. Any block after the Safe/EntryPoint deployments works.
const FORK_BLOCK = process.env.CELO_FORK_BLOCK ?? "80100000";
const run = process.env.SKIP_FORK_E2E !== "1" && anvilAvailable();
const OUT = path.join(REPO_ROOT, "contracts/out");
const E18 = BigInt(10) ** BigInt(18);

function artifact(file: string, name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(path.join(OUT, file, `${name}.json`), "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

describe.skipIf(!run)("passkey Safe on a Celo mainnet fork", () => {
  let anvil: Anvil;
  let chain: ReturnType<typeof defineChain>;
  let client: PublicClient;
  let db: Db;

  beforeAll(async () => {
    if (!existsSync(path.join(OUT, "TreasuryPolicy.sol/TreasuryPolicy.json"))) {
      const build = spawnSync("mise", ["exec", "--", "forge", "build"], { cwd: path.join(REPO_ROOT, "contracts"), stdio: "ignore" });
      if (build.status !== 0) throw new Error("forge build failed");
    }
    anvil = await startAnvil(["--fork-url", FORK_URL, "--fork-block-number", FORK_BLOCK, "--retries", "10", "--timeout", "30000"]);
    chain = defineChain({ ...celo, rpcUrls: { default: { http: [anvil.url] } } });
    client = createPublicClient({ chain, transport: http(anvil.url) }) as PublicClient;
    db = await createTestDb();
  }, 180_000);

  afterAll(async () => {
    await anvil?.stop();
  });

  it("creates the Safe with a passkey and approves a payment", async () => {
    expect(await client.getChainId()).toBe(42220);
    const wallet = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain, transport: http(anvil.url) });
    const [deployer, signer2, signer3, agent] = [ANVIL_KEYS[0], ANVIL_KEYS[1], ANVIL_KEYS[2], ANVIL_KEYS[3]].map(wallet);
    type W = ReturnType<typeof wallet>;
    const write = (w: W, p: Record<string, unknown>) => w.writeContract({ chain, account: w.account, ...p } as never) as Promise<Hex>;
    const deploy = (w: W, p: Record<string, unknown>) => w.deployContract({ chain, account: w.account, ...p } as never) as Promise<Hex>;
    const mined = async (hash: Hex) => {
      const r = await waitMined(client, hash);
      expect(r.status).toBe("success");
      return r;
    };

    // 1. Enrollment: the server computes the counterfactual Safe from the public key.
    const person = await seedPerson(db, { name: "Ana" });
    const passkey = createVirtualPasskey({ rpId: "localhost" });
    const enrolled = await registerPasskey(
      { token: await seedLink(db, person.id, "enroll"), credentialId: passkey.credential.id, publicKey: passkey.credential.publicKey },
      { db, computeSafeAddress: (c) => passkeySafeAddress(client, c) },
    );
    if (!enrolled.ok) throw new Error(enrolled.message);
    const safe = enrolled.safeAddress;
    expect(await client.getCode({ address: safe })).toBeUndefined();

    // 2. The real treasury, with the not-yet-deployed Safe as a signer (threshold 2 of 3).
    const wars = artifact("MockWARS.sol", "MockWARS");
    const policy = artifact("TreasuryPolicy.sol", "TreasuryPolicy");
    const token = (await mined(await deploy(deployer, { ...wars, args: [] }))).contractAddress as Address;
    const treasury = (
      await mined(
        await deploy(deployer, {
          ...policy,
          args: [token, [safe, signer2.account.address, signer3.account.address], BigInt(2), agent.account.address, BigInt(1000) * E18, BigInt(3000) * E18, `0x${"00".repeat(32)}`, zeroAddress],
        }),
      )
    ).contractAddress as Address;
    const t = { address: treasury, abi: treasuryPolicyAbi } as const;

    // Vendor and budget line enter by proposal (signers 2 and 3), the treasury gets wARS.
    const vendor = privateKeyToAccount(ANVIL_KEYS[4]).address;
    const cuit = BigInt(20123456789);
    const lineId = keccak256(stringToBytes("mantenimiento"));
    const vendorData = encodeAbiParameters([{ type: "address" }, { type: "uint64" }, { type: "bool" }], [vendor, cuit, true]);
    const budgetData = encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }], [lineId, BigInt(100000) * E18, BigInt(1830297600)]);
    await mined(await write(signer2, { ...t, functionName: "propose", args: [2, vendorData] }));
    await mined(await write(signer3, { ...t, functionName: "approveProposal", args: [BigInt(1)] }));
    await mined(await write(signer2, { ...t, functionName: "propose", args: [0, budgetData] }));
    await mined(await write(signer3, { ...t, functionName: "approveProposal", args: [BigInt(2)] }));
    await mined(await write(deployer, { address: token, abi: wars.abi, functionName: "mint", args: [treasury, BigInt(50000) * E18] }));

    // 3. The agent proposes $ 5.000 (over the $ 1.000 cap): pending. Signer 2 approves.
    const invoice = { cuit, tipo: 11, ptoVta: 2, nro: BigInt(345) };
    await mined(
      await write(agent, { ...t, functionName: "proposePayment", args: [vendor, invoice, BigInt(5000) * E18, lineId, `0x${"11".repeat(32)}`] }),
    );
    expect((await client.readContract({ ...t, functionName: "payment", args: [BigInt(1)] })).status).toBe(1); // Pending
    await mined(await write(signer2, { ...t, functionName: "approve", args: [BigInt(1)] }));

    // 4. The page sends the passkey's approval through /api/bundler with the link for payment 1.
    // No paymaster here: the Safe prefunds its own gas.
    await client.request({ method: "anvil_setBalance" as never, params: [safe, `0x${parseEther("5").toString(16)}`] as never });
    const linkToken = await seedLink(db, person.id, "sign", { paymentId: "1" });
    const suffix = attributionSuffix();
    const bundler = localBundler({ rpcUrl: anvil.url, chain, publicClient: client, bundlerKey: ANVIL_KEYS[4] as Hex });
    const deps: BundlerDeps = {
      db,
      chainId: 42220,
      policy: {
        treasury,
        wars: token,
        attributionSuffix: suffix,
        isSigner: (s) => client.readContract({ ...t, functionName: "isSigner", args: [s] }),
        ...dbLookups(db),
      },
      bundler: bundler.forward,
      node: httpForward(anvil.url),
      rateLimiter: createMemoryRateLimiter(),
    };
    const transport = custom(
      {
        async request({ method, params }) {
          const { status, body } = await handleBundlerRpc({ jsonrpc: "2.0", id: 1, method, params }, linkToken, deps);
          if (body.error) throw new Error(`${status} ${body.error.message} ${JSON.stringify(body.error.data)}`);
          return body.result;
        },
      },
      { retryCount: 0 },
    );

    const result = await sendSafeCalls({
      credential: passkey.credential,
      calls: [{ to: treasury, data: approveData(BigInt(1)) }],
      chainId: 42220,
      token: linkToken,
      rpId: "localhost",
      attributionSuffix: suffix,
      transport,
      sponsored: false,
      getFn: passkey.getFn,
    });

    // 5. The first operation deployed the Safe, and its approval executed the payment.
    expect(result.success).toBe(true);
    expect(result.sender).toBe(safe);
    expect(passkey.signatures()).toBe(1);
    expect(await client.getCode({ address: safe })).toMatch(/^0x.+/);
    expect(await client.readContract({ ...t, functionName: "hasApproved", args: [BigInt(1), safe] })).toBe(true);
    const payment = await client.readContract({ ...t, functionName: "payment", args: [BigInt(1)] });
    expect(payment.status).toBe(2); // Executed
    expect(await client.readContract({ address: token, abi: wars.abi, functionName: "balanceOf", args: [vendor] })).toBe(BigInt(5000) * E18);
    expect(bundler.handled).toHaveLength(1);
    expect(bundler.handled[0].callData.toLowerCase().endsWith(suffix.slice(2).toLowerCase())).toBe(true);

    // 6. The sign link was consumed: it can't authorize another operation.
    const [link] = await db.select().from(signLinks).where(eq(signLinks.token, linkToken));
    expect(link.usedAt).not.toBeNull();
    const again = await handleBundlerRpc(
      { jsonrpc: "2.0", id: 2, method: "eth_sendUserOperation", params: [userOp(safe, bundler.handled[0].callData), ENTRY_POINT.address] },
      linkToken,
      deps,
    );
    expect(again).toMatchObject({ status: 403, body: { error: { data: { reason: "used" } } } });
  }, 240_000);
});

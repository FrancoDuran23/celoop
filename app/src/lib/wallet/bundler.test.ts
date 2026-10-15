import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { createTestDb } from "@/db/testing";
import { dbLookups, handleBundlerRpc, type BundlerDeps, type JsonRpcRequest } from "./bundler";
import { ENTRY_POINT } from "./constants";
import { resolveSignLink } from "./links";
import { createMemoryRateLimiter } from "./rate-limit";
import {
  SIGNER_SAFE,
  STRANGER,
  TREASURY,
  VENDOR_SAFE,
  WARS,
  approveData,
  policyContext,
  safeCallData,
  seedLink,
  seedPerson,
  seedVendor,
  transferData,
  userOp,
} from "./testing/fixtures";

let db: Db;
let sent: JsonRpcRequest[];
let deps: BundlerDeps;

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  deps = {
    db,
    chainId: 42220,
    policy: { ...policyContext(), ...dbLookups(db) },
    bundler: async (req) => {
      sent.push(req);
      return { jsonrpc: "2.0", id: req.id, result: req.method === "eth_sendUserOperation" ? "0xhash" : { ok: true } };
    },
    node: async (req) => {
      sent.push(req);
      return { jsonrpc: "2.0", id: req.id, result: "0x1" };
    },
    rateLimiter: createMemoryRateLimiter(30),
    sponsorshipPolicyId: "sp_test",
  };
}, 60_000);

const rpc = (method: string, params: unknown[] = []) => ({ jsonrpc: "2.0", id: 1, method, params });
const approveOp = (id = BigInt(3)) => userOp(SIGNER_SAFE, safeCallData(TREASURY, approveData(id)));

async function signerLink(target: { paymentId: string } | null = { paymentId: "3" }) {
  const person = await seedPerson(db, { safe: SIGNER_SAFE });
  return seedLink(db, person.id, "sign", target);
}

describe("/api/bundler", () => {
  it("refuses methods it doesn't know, like raw transactions", async () => {
    const token = await signerLink();
    for (const method of ["eth_sendRawTransaction", "eth_sendTransaction", "debug_traceCall", "pm_validateSponsorshipPolicies"]) {
      const r = await handleBundlerRpc(rpc(method), token, deps);
      expect(r.status).toBe(403);
    }
    expect(sent).toHaveLength(0);
  });

  it("refuses everything without a valid link", async () => {
    await signerLink();
    expect((await handleBundlerRpc(rpc("eth_call", [{}]), null, deps)).status).toBe(403);
    expect((await handleBundlerRpc(rpc("eth_call", [{}]), "bogus", deps)).status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("relays node reads and answers the chain id itself", async () => {
    const token = await signerLink();
    expect((await handleBundlerRpc(rpc("eth_chainId"), token, deps)).body.result).toBe("0xa4ec");
    const r = await handleBundlerRpc(rpc("eth_getCode", [SIGNER_SAFE, "latest"]), token, deps);
    expect(r).toMatchObject({ status: 200, body: { result: "0x1" } });
    expect(sent.map((s) => s.method)).toEqual(["eth_getCode"]);
  });

  it("sponsors an allowed operation with the server's policy id, whatever the client asked", async () => {
    const token = await signerLink();
    const r = await handleBundlerRpc(
      rpc("pm_getPaymasterData", [approveOp(), ENTRY_POINT.address, "0xa4ec", { sponsorshipPolicyId: "sp_evil" }]),
      token,
      deps,
    );
    expect(r.status).toBe(200);
    expect(sent[0].params?.[3]).toEqual({ sponsorshipPolicyId: "sp_test" });
  });

  it("refuses to sponsor what the policy blocks", async () => {
    const token = await signerLink();
    const noTag = userOp(SIGNER_SAFE, safeCallData(TREASURY, approveData(BigInt(3)), { suffix: null }));
    const r = await handleBundlerRpc(rpc("pm_getPaymasterData", [noTag, ENTRY_POINT.address, "0xa4ec", {}]), token, deps);
    expect(r).toMatchObject({ status: 403, body: { error: { data: { reason: "no_tag" } } } });
    const other = await handleBundlerRpc(rpc("pm_getPaymasterData", [approveOp(BigInt(9)), ENTRY_POINT.address, "0xa4ec", {}]), token, deps);
    expect(other).toMatchObject({ status: 403, body: { error: { data: { reason: "scope" } } } });
    const wrongChain = await handleBundlerRpc(rpc("pm_getPaymasterData", [approveOp(), ENTRY_POINT.address, "0x1", {}]), token, deps);
    expect(wrongChain.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("refuses an operation from a Safe that is not the link's person", async () => {
    const ana = await seedPerson(db, { name: "Ana", safe: SIGNER_SAFE });
    await seedPerson(db, { name: "Beto", safe: VENDOR_SAFE });
    const anasToken = await seedLink(db, ana.id, "sign", { paymentId: "3" });
    const betosOp = userOp(VENDOR_SAFE, safeCallData(TREASURY, approveData(BigInt(3))));
    const r = await handleBundlerRpc(rpc("eth_sendUserOperation", [betosOp, ENTRY_POINT.address]), anasToken, deps);
    expect(r).toMatchObject({ status: 403, body: { error: { data: { reason: "wrong_person" } } } });
  });

  it("consumes a sign link when the operation is sent, then only allows reads", async () => {
    const token = await signerLink();
    const sendIt = () => handleBundlerRpc(rpc("eth_sendUserOperation", [approveOp(), ENTRY_POINT.address]), token, deps);
    expect(await sendIt()).toMatchObject({ status: 200, body: { result: "0xhash" } });
    const r = await resolveSignLink(db, token, { purposes: ["sign"] });
    expect(r).toEqual({ ok: false, error: "used" });
    expect((await sendIt()).status).toBe(403);
    const receipt = await handleBundlerRpc(rpc("eth_getUserOperationReceipt", ["0xhash"]), token, deps);
    expect(receipt.status).toBe(200);
  });

  it("lets a vendor withdraw with its reusable link", async () => {
    const person = await seedPerson(db, { safe: VENDOR_SAFE, roles: ["proveedor"] });
    await seedVendor(db, { personId: person.id, address: VENDOR_SAFE });
    const token = await seedLink(db, person.id, "vendor");
    const op = userOp(VENDOR_SAFE, safeCallData(WARS, transferData(STRANGER, BigInt(5))));
    for (let i = 0; i < 2; i++) {
      const r = await handleBundlerRpc(rpc("eth_sendUserOperation", [op, ENTRY_POINT.address]), token, deps);
      expect(r.status).toBe(200);
    }
  });

  it("limits sponsorships per Safe per day", async () => {
    deps.rateLimiter = createMemoryRateLimiter(2);
    const token = await signerLink();
    const sponsor = () => handleBundlerRpc(rpc("pm_sponsorUserOperation", [approveOp(), ENTRY_POINT.address]), token, deps);
    expect((await sponsor()).status).toBe(200);
    expect((await sponsor()).status).toBe(200);
    expect((await sponsor()).status).toBe(429);
  });

  it("strips state overrides from gas estimation", async () => {
    const token = await signerLink();
    await handleBundlerRpc(rpc("eth_estimateUserOperationGas", [approveOp(), ENTRY_POINT.address, { [SIGNER_SAFE]: { balance: "0xffff" } }]), token, deps);
    expect(sent[0].params).toHaveLength(2);
  });

  it("answers 503 for operations when no bundler is configured", async () => {
    deps.bundler = null;
    const token = await signerLink();
    expect((await handleBundlerRpc(rpc("eth_sendUserOperation", [approveOp(), ENTRY_POINT.address]), token, deps)).status).toBe(503);
  });
});

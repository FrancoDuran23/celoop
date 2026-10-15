import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db";
import { createTestDb } from "@/db/testing";
import { dbLookups, type BundlerDeps } from "@/lib/wallet/bundler";
import { ENTRY_POINT } from "@/lib/wallet/constants";
import { createMemoryRateLimiter } from "@/lib/wallet/rate-limit";
import { SIGNER_SAFE, TREASURY, approveData, policyContext, safeCallData, seedLink, seedPerson, userOp } from "@/lib/wallet/testing/fixtures";

let deps: BundlerDeps;
vi.mock("@/lib/wallet/server", () => ({ bundlerDeps: async () => deps }));
const { POST } = await import("./route");

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  deps = {
    db,
    chainId: 42220,
    policy: { ...policyContext(), ...dbLookups(db) },
    bundler: async (req) => ({ jsonrpc: "2.0", id: req.id, result: "0xhash" }),
    node: async (req) => ({ jsonrpc: "2.0", id: req.id, result: "0x1" }),
    rateLimiter: createMemoryRateLimiter(),
  };
}, 60_000);

const call = (token: string | null, body: unknown) =>
  POST(new NextRequest(`http://localhost/api/bundler${token ? `?t=${token}` : ""}`, { method: "POST", body: JSON.stringify(body) }));

describe("POST /api/bundler", () => {
  it("relays an allowed operation", async () => {
    const person = await seedPerson(db, { safe: SIGNER_SAFE });
    const token = await seedLink(db, person.id, "sign", { paymentId: "3" });
    const op = userOp(SIGNER_SAFE, safeCallData(TREASURY, approveData(BigInt(3))));
    const res = await call(token, { jsonrpc: "2.0", id: 7, method: "eth_sendUserOperation", params: [op, ENTRY_POINT.address] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 7, result: "0xhash" });
  });

  it("answers 403 to everything else", async () => {
    const person = await seedPerson(db, { safe: SIGNER_SAFE });
    const token = await seedLink(db, person.id, "sign", { paymentId: "3" });
    expect((await call(token, { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0x00"] })).status).toBe(403);
    expect((await call(null, { jsonrpc: "2.0", id: 1, method: "eth_call", params: [] })).status).toBe(403);
    const noTag = userOp(SIGNER_SAFE, safeCallData(TREASURY, approveData(BigInt(3)), { suffix: null }));
    expect((await call(token, { jsonrpc: "2.0", id: 1, method: "eth_sendUserOperation", params: [noTag, ENTRY_POINT.address] })).status).toBe(403);
  });

  it("rejects batches and bad JSON", async () => {
    expect((await call("x", [{ jsonrpc: "2.0", id: 1, method: "eth_chainId" }])).status).toBe(400);
    const res = await POST(new NextRequest("http://localhost/api/bundler", { method: "POST", body: "{" }));
    expect(res.status).toBe(400);
  });
});

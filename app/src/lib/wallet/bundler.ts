// The JSON-RPC proxy behind /api/bundler. Server only.
//
// The browser talks to one URL (`/api/bundler?t=<sign link token>`) for everything a passkey
// Safe needs: a few node reads, the bundler methods and Pimlico's paymaster. The Pimlico key never
// leaves the server, and anything that could spend sponsorship goes through checkUserOperation.
import { sql } from "drizzle-orm";
import { toHex, type Address } from "viem";
import type { Db } from "@/db";
import { passkeys, vendors } from "@/db/schema";
import { consumeSignLink, resolveSignLink, type LinkPurpose, type ResolvedLink } from "./links";
import { checkUserOperation, type PolicyContext } from "./policy";
import type { RateLimiter } from "./rate-limit";

export type JsonRpcId = number | string | null;
export type JsonRpcRequest = { jsonrpc: "2.0"; id: JsonRpcId; method: string; params?: unknown[] };
export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};
export type Forward = (request: JsonRpcRequest) => Promise<JsonRpcResponse>;

export type BundlerDeps = {
  db: Db;
  chainId: number;
  policy: PolicyContext;
  /** Pimlico (or a local bundler). null when not configured. */
  bundler: Forward | null;
  /** The app's RPC node, for the few reads the browser needs. */
  node: Forward;
  rateLimiter: RateLimiter;
  sponsorshipPolicyId?: string;
  now?: () => Date;
};

export type BundlerReply = { status: number; body: JsonRpcResponse };

/** Reads the Safe client needs from a node (nonce, deployment, fees, proxy creation code). */
const NODE_METHODS = new Set([
  "eth_blockNumber",
  "eth_call",
  "eth_getCode",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getTransactionReceipt",
]);

/** Bundler reads with no sponsorship involved. */
const BUNDLER_READ_METHODS = new Set([
  "eth_supportedEntryPoints",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "pimlico_getUserOperationGasPrice",
  "pimlico_getUserOperationStatus",
]);

/** Methods carrying a UserOperation: each one is checked against the policy. */
const OPERATION_METHODS = new Set([
  "eth_estimateUserOperationGas",
  "pm_getPaymasterStubData",
  "pm_getPaymasterData",
  "pm_sponsorUserOperation",
  "eth_sendUserOperation",
]);

/** Sponsorship grants: these count against the per-Safe limit. */
const SPONSOR_METHODS = new Set(["pm_getPaymasterData", "pm_sponsorUserOperation"]);

const PURPOSES: LinkPurpose[] = ["sign", "vendor"];

const reply = (status: number, id: JsonRpcId, body: Omit<JsonRpcResponse, "jsonrpc" | "id">): BundlerReply => ({
  status,
  body: { jsonrpc: "2.0", id, ...body },
});

const forbidden = (id: JsonRpcId, reason: string, message = "Operación no permitida") =>
  reply(403, id, { error: { code: -32001, message, data: { reason } } });

function parseRequest(payload: unknown): JsonRpcRequest | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.method !== "string") return null;
  if (p.params !== undefined && !Array.isArray(p.params)) return null;
  const id = typeof p.id === "number" || typeof p.id === "string" ? p.id : null;
  return { jsonrpc: "2.0", id, method: p.method, params: (p.params as unknown[] | undefined) ?? [] };
}

export async function handleBundlerRpc(payload: unknown, token: string | null, deps: BundlerDeps): Promise<BundlerReply> {
  const request = parseRequest(payload);
  if (!request) return reply(400, null, { error: { code: -32600, message: "Invalid request" } });
  const { id, method } = request;
  const params = request.params ?? [];
  const now = deps.now?.() ?? new Date();

  const known = method === "eth_chainId" || NODE_METHODS.has(method) || BUNDLER_READ_METHODS.has(method) || OPERATION_METHODS.has(method);
  if (!known) return forbidden(id, "method");

  // Reads accept a link that was already used: the page still polls the receipt after sending.
  const isOperation = OPERATION_METHODS.has(method);
  const resolved = await resolveSignLink(deps.db, token, { purposes: PURPOSES, now, allowUsed: !isOperation });
  if (!resolved.ok) return forbidden(id, resolved.error, "Link inválido");
  const link = resolved.link;

  if (method === "eth_chainId") return reply(200, id, { result: toHex(deps.chainId) });
  if (NODE_METHODS.has(method)) return relay(deps.node, request);
  if (!deps.bundler) return reply(503, id, { error: { code: -32603, message: "Bundler not configured" } });
  if (BUNDLER_READ_METHODS.has(method)) return relay(deps.bundler, request);

  return handleOperation(request, params, link, deps, now);
}

async function handleOperation(
  request: JsonRpcRequest,
  params: unknown[],
  link: ResolvedLink,
  deps: BundlerDeps,
  now: Date,
): Promise<BundlerReply> {
  const { id, method } = request;
  const [userOp, entryPoint] = params;
  const check = await checkUserOperation(userOp, deps.policy, { link, entryPoint: entryPoint ?? null });
  if (!check.ok) return forbidden(id, check.reason);

  let forwardParams: unknown[];
  switch (method) {
    case "eth_estimateUserOperationGas":
    case "eth_sendUserOperation":
      // No state overrides: estimate against the real chain.
      forwardParams = [userOp, entryPoint];
      break;
    case "pm_getPaymasterStubData":
    case "pm_getPaymasterData": {
      const chainId = params[2];
      if (typeof chainId !== "string" || BigInt(chainId) !== BigInt(deps.chainId)) return forbidden(id, "chain");
      forwardParams = [userOp, entryPoint, chainId, sponsorContext(deps)];
      break;
    }
    case "pm_sponsorUserOperation":
      forwardParams = [userOp, entryPoint, sponsorContext(deps)];
      break;
    default:
      return forbidden(id, "method");
  }

  if (SPONSOR_METHODS.has(method) && !deps.rateLimiter.take(check.sender, now.getTime())) {
    return reply(429, id, { error: { code: -32005, message: "Demasiadas operaciones por hoy", data: { reason: "rate" } } });
  }

  const result = await relay(deps.bundler!, { ...request, params: forwardParams });
  if (method === "eth_sendUserOperation" && result.status === 200 && !result.body.error) {
    await consumeSignLink(deps.db, link, now);
  }
  return result;
}

function sponsorContext(deps: BundlerDeps) {
  return deps.sponsorshipPolicyId ? { sponsorshipPolicyId: deps.sponsorshipPolicyId } : undefined;
}

async function relay(forward: Forward, request: JsonRpcRequest): Promise<BundlerReply> {
  try {
    const response = await forward(request);
    return { status: 200, body: { ...response, jsonrpc: "2.0", id: request.id } };
  } catch (error) {
    console.error("bundler relay failed", request.method, error);
    return reply(502, request.id, { error: { code: -32603, message: "Upstream error" } });
  }
}

/** A forwarder that POSTs JSON-RPC to `url`. */
export function httpForward(url: string, fetchFn: typeof fetch = fetch): Forward {
  return async (request) => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    const body = (await res.json()) as JsonRpcResponse;
    if (!body || typeof body !== "object") throw new Error(`Bad upstream response (${res.status})`);
    return body;
  };
}

/** DB lookups for the policy: registered passkey Safes and vendor addresses. */
export function dbLookups(db: Db): Pick<PolicyContext, "isRegisteredSafe" | "isVendor"> {
  return {
    async isRegisteredSafe(safe: Address) {
      const rows = await db
        .select({ id: passkeys.id })
        .from(passkeys)
        .where(sql`lower(${passkeys.safeAddress}) = ${safe.toLowerCase()}`)
        .limit(1);
      return rows.length > 0;
    },
    async isVendor(safe: Address) {
      const rows = await db
        .select({ id: vendors.id })
        .from(vendors)
        // A vendor that was disabled still has to be able to withdraw what it was paid.
        .where(sql`lower(${vendors.address}) = ${safe.toLowerCase()}`)
        .limit(1);
      return rows.length > 0;
    },
  };
}

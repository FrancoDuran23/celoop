// JSON-RPC proxy to the node and to Pimlico for passkey Safes. Policy in lib/wallet/policy.ts.
import type { NextRequest } from "next/server";
import { handleBundlerRpc } from "@/lib/wallet/bundler";
import { bundlerDeps } from "@/lib/wallet/server";

const MAX_BODY_BYTES = 128 * 1024;

const rpcError = (status: number, message: string) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message } }, { status });

export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return rpcError(413, "Request too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return rpcError(413, "Request too large");
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return rpcError(400, "Invalid JSON");
  }
  if (Array.isArray(payload)) return rpcError(400, "Batches are not supported");

  let deps;
  try {
    deps = await bundlerDeps();
  } catch (error) {
    console.error("bundler not configured", error);
    return rpcError(503, "Bundler not configured");
  }
  const { status, body } = await handleBundlerRpc(payload, request.nextUrl.searchParams.get("t"), deps);
  return Response.json(body, { status });
}

import { getDb } from "@/db";
import { loadAuditJson } from "@/lib/auditor/view";
import { parseCoopParam } from "@/lib/coop-query";

/** The audit report exactly as hashed on chain: keccak256 of this body = reportHash. */
export async function GET(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  if (!/^\d{1,20}$/.test(paymentId)) return new Response("Not found", { status: 404 });
  const json = await loadAuditJson(getDb(), BigInt(paymentId), parseCoopParam(new URL(request.url).searchParams.get("c")));
  if (json === null) return new Response("Not found", { status: 404 });
  return new Response(json, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}

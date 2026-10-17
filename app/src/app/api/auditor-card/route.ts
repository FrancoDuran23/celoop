import { connection } from "next/server";
import { agentCardFromEnv } from "@/lib/erc8004";

/** ERC-8004 registration file for the auditor. Served at /auditor.json via rewrite. */
export async function GET() {
  await connection();
  return Response.json(agentCardFromEnv("auditor"), {
    headers: { "cache-control": "public, max-age=60" },
  });
}

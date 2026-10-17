// Updates the ERC-8004 agent URI (setAgentURI). Sends nothing unless --yes, and --dry-run only simulates.
//
//   CHAIN=mainnet RPC_URL=https://forno.celo.org AGENT_PRIVATE_KEY=0x... AGENT_ID=123 \
//     APP_URL=https://<app> ATTRIBUTION_CODE=celo_97a761e4eeab DATABASE_URL=<neon> \
//     npx tsx scripts/update-agent-uri.ts                 # plan only, sends nothing
//   ... npx tsx scripts/update-agent-uri.ts --yes --dry-run
//   ... npx tsx scripts/update-agent-uri.ts --yes
//   ... npx tsx scripts/update-agent-uri.ts --yes https://<app>/agent.json
//   ... AUDITOR_ID=124 AUDITOR_PRIVATE_KEY=0x... npx tsx scripts/update-agent-uri.ts --auditor --yes --dry-run
//
// The URI defaults to $APP_URL/agent.json ($APP_URL/auditor.json with --auditor).
// A positional argument, or UPDATE_AGENT_URI, overrides it.
//
// Flags: --yes, --dry-run, --auditor.
// Reads CHAIN, RPC_URL, AGENT_PRIVATE_KEY, AGENT_ID, APP_URL, ATTRIBUTION_CODE, FEE_CURRENCY,
// DATABASE_URL, and optionally UPDATE_AGENT_URI, IDENTITY_REGISTRY.
// With --auditor: AUDITOR_PRIVATE_KEY and AUDITOR_ID.
import "dotenv/config";
import { parseArgs } from "./lib/guard";
import { updateAgentUri } from "./lib/update-agent-uri";

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const uri = positional[0] ?? process.env.UPDATE_AGENT_URI;
  const result = await updateAgentUri({
    yes: flags.has("yes"),
    dryRun: flags.has("dry-run"),
    role: flags.has("auditor") ? "auditor" : "treasurer",
    uri,
  });
  if (result.status === "needs-confirmation") process.exit(2);
  if (result.status === "refused") process.exit(1);
}

main().catch((e) => {
  console.error(`\nError: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

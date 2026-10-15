// Registers the agent's ERC-8004 identity and writes app/public/agent-registration.json.
//
//   anvil --fork-url https://forno.celo.org          # local fork of Celo mainnet (has the registry)
//   CHAIN=local RPC_URL=http://127.0.0.1:8545 AGENT_PRIVATE_KEY=0x... npx tsx scripts/register-agent.ts
//   CHAIN=mainnet ... npx tsx scripts/register-agent.ts          # shows the plan, sends nothing
//   CHAIN=mainnet ATTRIBUTION_CODE=... npx tsx scripts/register-agent.ts --yes
//
// Flags: --yes (required off local), --dry-run (simulate only), --force (register a second identity).
// Reads CHAIN, RPC_URL, AGENT_PRIVATE_KEY, APP_URL, ATTRIBUTION_CODE, FEE_CURRENCY, DATABASE_URL and,
// optionally, AGENT_NAME, AGENT_DESCRIPTION, TELEGRAM_BOT_USERNAME, IDENTITY_REGISTRY.
import "dotenv/config";
import { parseArgs } from "./lib/guard";
import { registerAgent } from "./lib/register-agent";

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const result = await registerAgent({ yes: flags.has("yes"), dryRun: flags.has("dry-run"), force: flags.has("force") });
  if (result.status === "needs-confirmation") process.exit(2);
  if (result.status === "refused" || result.status === "already-registered") process.exit(1);
}

main().catch((e) => {
  console.error(`\nError: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

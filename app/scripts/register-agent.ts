// Registers the agent's ERC-8004 identity. The on-chain URI is $APP_URL/agent.json
// (or /auditor.json with --auditor), which the Next app serves. Prints AGENT_ID / AUDITOR_ID.
// Also writes a local snapshot under app/public/*-registration.json.
//
//   anvil --fork-url https://forno.celo.org          # local fork of Celo mainnet (has the registry)
//   CHAIN=local RPC_URL=http://127.0.0.1:8545 AGENT_PRIVATE_KEY=0x... npx tsx scripts/register-agent.ts
//   CHAIN=mainnet ... npx tsx scripts/register-agent.ts          # shows the plan, sends nothing
//   CHAIN=mainnet ATTRIBUTION_CODE=celo_97a761e4eeab ... npx tsx scripts/register-agent.ts --yes --dry-run
//   CHAIN=mainnet ATTRIBUTION_CODE=celo_97a761e4eeab ... npx tsx scripts/register-agent.ts --yes
//
//   ... npx tsx scripts/register-agent.ts --auditor   # the auditor's own identity (AUDITOR_PRIVATE_KEY)
//
// Flags: --yes (required off local), --dry-run (simulate only; on mainnet still needs --yes),
// --force (register a second identity), --auditor.
// Reads CHAIN, RPC_URL, AGENT_PRIVATE_KEY, APP_URL, ATTRIBUTION_CODE, FEE_CURRENCY, DATABASE_URL and,
// optionally, AGENT_NAME, AGENT_DESCRIPTION (AUDITOR_NAME, AUDITOR_DESCRIPTION), TELEGRAM_BOT_USERNAME,
// IDENTITY_REGISTRY. With --auditor it reads AUDITOR_PRIVATE_KEY instead of AGENT_PRIVATE_KEY.
// Does not broadcast unless --yes is set and --dry-run is absent.
import "dotenv/config";
import { parseArgs } from "./lib/guard";
import { registerAgent } from "./lib/register-agent";

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const result = await registerAgent({
    yes: flags.has("yes"),
    dryRun: flags.has("dry-run"),
    force: flags.has("force"),
    role: flags.has("auditor") ? "auditor" : "treasurer",
  });
  if (result.status === "needs-confirmation") process.exit(2);
  if (result.status === "refused" || result.status === "already-registered") process.exit(1);
}

main().catch((e) => {
  console.error(`\nError: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

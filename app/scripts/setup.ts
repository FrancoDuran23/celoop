// Sets up an instance: deploy, contract configuration, database and environment.
//
//   npx tsx scripts/setup.ts scripts/config/demo.json            # local anvil
//   CHAIN=sepolia RPC_URL=... npx tsx scripts/setup.ts <config>  # shows the plan, sends nothing
//   CHAIN=sepolia ... npx tsx scripts/setup.ts <config> --yes    # sends
//
// Flags: --yes (required off local), --fresh-db (local PGlite: start from an empty database).
// Reads CHAIN, RPC_URL, DEPLOYER_PRIVATE_KEY, AGENT_PRIVATE_KEY or AGENT_ADDRESS, ATTRIBUTION_CODE,
// DATABASE_URL and, on Sepolia, WARS_ADDRESS, from the environment or app/.env.
import "dotenv/config";
import { parseArgs } from "./lib/guard";
import { runSetup } from "./lib/setup";

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [configPath] = positional;
  if (!configPath) {
    console.error("Uso: npx tsx scripts/setup.ts scripts/config/<nombre>.json [--yes] [--fresh-db]");
    process.exit(64);
  }
  const result = await runSetup({ configPath, yes: flags.has("yes"), freshDb: flags.has("fresh-db") });
  if (result.status === "needs-confirmation") process.exit(2);
  if (result.status === "refused") process.exit(1);
}

main().catch((e) => {
  console.error(`\nError: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});

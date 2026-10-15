// Shared environment access. Read lazily so tests and builds don't need every variable.
// Every variable is documented in .env.example.
import { z } from "zod";

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const schema = z.object({
  CHAIN: z.enum(["local", "sepolia", "mainnet"]).default("local"),
  RPC_URL: z.string().url().optional(),
  AGENT_PRIVATE_KEY: hex.optional(),
  /** The auditor's own key: it can only clear or flag payments on the contract. Never the agent's key. */
  AUDITOR_PRIVATE_KEY: hex.optional(),
  /** "on" lets the agent and the auditor send transactions; anything else is a dry run. */
  AGENT_SEND: z.string().default("off"),
  TREASURY_ADDRESS: address.optional(),
  BOX_FACTORY_ADDRESS: address.optional(),
  WARS_ADDRESS: address.optional(),
  /** Block the treasury was deployed in; the indexer starts there. */
  DEPLOY_BLOCK: z.coerce.bigint().optional(),
  /** CIP-64 fee currency (USDT/USDC adapter) the agent pays gas in. Unset = pay in CELO (local/dev). */
  FEE_CURRENCY: address.optional(),
  /** ERC-8021 attribution code issued at hackathon enrollment. Required on mainnet. */
  ATTRIBUTION_CODE: z.string().optional(),
  PIMLICO_API_KEY: z.string().optional(),
  PIMLICO_SPONSORSHIP_POLICY_ID: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().default("claude-sonnet-5-5"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  /** Shared secret the external cron sends to /api/tick. */
  TICK_SECRET: z.string().optional(),
  /** Public base URL, e.g. https://cooperadora.vercel.app. Used in links sent over Telegram. */
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** WebAuthn relying party id (the app's host). */
  RP_ID: z.string().default("localhost"),
  SESSION_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    // Empty values (KEY= in .env) count as unset.
    const set = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
    cached = schema.parse(set);
  }
  return cached;
}

/** For tests: override variables and drop the cache. */
export function resetEnv(overrides: Partial<Record<keyof Env, string>> = {}) {
  Object.assign(process.env, overrides);
  cached = undefined;
}

/** Returns the variable or throws a clear error naming it. */
export function required<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(`Missing environment variable ${key}`);
  }
  return value as NonNullable<Env[K]>;
}

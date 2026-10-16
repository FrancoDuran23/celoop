// "Aportar": a one-time deposit box per tap and a Ripio on-ramp link that pays into it.
// The ref ↔ person relation lives only in Postgres; on chain there is just the box.
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { contributionIntents, contributions } from "@/db/schema";
import { scopeId } from "@/lib/tenant";
import type { AgentDeps } from "./deps";
import { pesosDecimal } from "./format";

/**
 * Ripio's public ramp. Parameters as parsed by ramp.ripio.com's deep link (see
 * docs/research/ripio.md and lib/wallet/ripio.ts): mode, country, chain (numeric id), token
 * (symbol), amount (decimal with ".") and address. Ripio only runs on Celo mainnet.
 */
export const RIPIO_RAMP_URL = "https://ramp.ripio.com/";
export const CELO_MAINNET_ID = 42220;

export function ripioOnrampUrl(args: { amount: bigint; address: Address }): string {
  const params = new URLSearchParams({
    mode: "onramp",
    country: "AR",
    chain: String(CELO_MAINNET_ID),
    token: "WARS",
    amount: pesosDecimal(args.amount),
    address: args.address,
  });
  return `${RIPIO_RAMP_URL}?${params.toString()}`;
}

/** Amounts offered as buttons, in pesos. Any other amount can be typed. */
export const SUGGESTED_AMOUNTS = [3000, 5000, 10000] as const;

export type ContributionIntent = { ref: Hex; boxAddress: Address; amount: bigint; url: string };

export async function createContributionIntent(
  deps: AgentDeps,
  args: { personId: number; amount: bigint },
): Promise<ContributionIntent> {
  const ref = `0x${randomBytes(32).toString("hex")}` as Hex;
  const boxAddress = await deps.chain.boxAddress(ref);
  await deps.db.insert(contributionIntents).values({
    ref,
    cooperadoraId: scopeId(deps.cooperadoraId),
    personId: args.personId,
    suggestedAmount: args.amount.toString(),
    boxAddress,
    status: "open",
    createdAt: deps.now(),
  });
  return { ref, boxAddress, amount: args.amount, url: ripioOnrampUrl({ amount: args.amount, address: boxAddress }) };
}

/** A person's money contributions, newest first. */
export async function contributionsOf(deps: Pick<AgentDeps, "db" | "cooperadoraId">, personId: number, limit = 10) {
  return deps.db
    .select()
    .from(contributions)
    .where(
      and(
        eq(contributions.cooperadoraId, scopeId(deps.cooperadoraId)),
        eq(contributions.personId, personId),
        eq(contributions.kind, "dinero"),
      ),
    )
    .orderBy(desc(contributions.occurredAt))
    .limit(limit);
}

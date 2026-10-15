// Ripio's public off-ramp (ramp.ripio.com). Browser-safe.
//
// Parameters confirmed against the live page's deep-link parser (ramp.ripio.com, 2026-10-14):
// - path `/off-ramp` (`/offramp` redirects there);
// - `mode`: "onramp" | "offramp". The parser defaults to "onramp", which then requires `address`,
//   so the off-ramp link has to say `mode=offramp`;
// - `country`: ISO code, upper-cased ("AR");
// - `chain`: numeric chain id (Celo = 42220);
// - `token`: symbol, upper-cased ("WARS");
// - `amount`: positive number with "." as decimal separator;
// - `address`: optional for the off-ramp; when valid it is prefilled and locked.
// The deep link is only parsed when country, chain, token and amount are all present.
// docs.ripio.com documents the B2B API and widget, not these public URL parameters.
import type { Address } from "viem";
import { toDecimalString } from "./format";

export const RIPIO_OFFRAMP_URL = "https://ramp.ripio.com/off-ramp";
export const CELO_CHAIN_ID = 42220;

export type RipioOfframpParams = {
  /** wARS base units to sell. */
  amount: bigint;
  /** Wallet the wARS leave from (the vendor's Safe). */
  address?: Address;
  /** Defaults to Celo mainnet: Ripio has no testnet. */
  chainId?: number;
};

export function ripioOfframpUrl({ amount, address, chainId = CELO_CHAIN_ID }: RipioOfframpParams): string {
  if (amount <= BigInt(0)) throw new Error("amount must be positive");
  const params = new URLSearchParams({
    mode: "offramp",
    country: "AR",
    chain: String(chainId),
    token: "WARS",
    amount: toDecimalString(amount),
  });
  if (address) params.set("address", address);
  return `${RIPIO_OFFRAMP_URL}?${params.toString()}`;
}

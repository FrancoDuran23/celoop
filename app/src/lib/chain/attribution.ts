// ERC-8021 attribution: every transaction the project sends ends with this suffix.
// The hackathon cannot backfill untagged transactions, so mainnet refuses to send without a code.
import { fromDataSuffix, toDataSuffix } from "@celo/attribution-tags";
import { concatHex, type Hex } from "viem";
import { env } from "@/lib/env";

/** Placeholder used off mainnet when ATTRIBUTION_CODE is unset, so local txs still carry a well-formed tag. */
const DEV_CODE = "cooperadora_dev";

export function attributionCode(): string {
  const { ATTRIBUTION_CODE, CHAIN } = env();
  if (ATTRIBUTION_CODE) return ATTRIBUTION_CODE;
  if (CHAIN === "mainnet") throw new Error("ATTRIBUTION_CODE is required on mainnet");
  return DEV_CODE;
}

export function attributionSuffix(): Hex {
  return toDataSuffix(attributionCode()) as Hex;
}

/** Appends the attribution suffix to calldata (or to a UserOperation's callData). */
export function withAttribution(data: Hex): Hex {
  return concatHex([data, attributionSuffix()]);
}

/** Codes found at the end of calldata, or null if it carries no tag. */
export function readAttribution(data: Hex): string[] | null {
  const decoded = fromDataSuffix(data);
  return decoded ? [...decoded.codes] : null;
}

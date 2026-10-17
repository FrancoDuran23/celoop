// ERC-8021 attribution: every transaction the project sends ends with this suffix.
// The hackathon cannot backfill untagged transactions, so mainnet refuses to send without a code.
//
// Two ways to apply it, both from @celo/attribution-tags:
//   - withAttribution(data) concatenates toDataSuffix onto calldata. The agent and the auditor sign
//     with prepareTransactionRequest + signTransaction + sendRawTransaction (CIP-64), and that path
//     is not wrapped by the package's wallet extension, so the suffix has to be on `data` itself.
//   - tagClient(wallet) is the package's withAttribution([...]) extension. It tags sendTransaction
//     (suffix inside `data`) and writeContract (via `dataSuffix`). Same code twice is merged into
//     one suffix, so tagging an already-tagged payload does not double it.
// UserOperations are different: the on-chain transaction is the bundler's EntryPoint.handleOps,
// which we do not sign. The suffix goes on the UserOperation callData (the Safe's executeUserOp
// bytes, via onchainIdentifier). @celo/attribution-tags fromEntryPointCalldata reads it there.
import { fromDataSuffix, toDataSuffix, withAttribution as tagWallet } from "@celo/attribution-tags";
import { concatHex, type Hex } from "viem";
import { env } from "@/lib/env";

/** Assigned at enrollment for Agents on Open Rails. Set ATTRIBUTION_CODE to this before mainnet. */
export const HACKATHON_ATTRIBUTION_CODE = "celo_97a761e4eeab";

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

/** viem extension: every sendTransaction / writeContract from this client carries the suffix. */
export function attributionExtension() {
  return tagWallet(attributionCode());
}

/**
 * Returns `client` with the package extension applied. The cast keeps viem's own method types;
 * the package types a wallet structurally and does not know viem's overloads.
 */
export function tagClient<T>(client: T): T {
  const extendable = client as T & { extend: (extension: unknown) => T };
  return extendable.extend(attributionExtension());
}

/** Codes found at the end of calldata, or null if it carries no tag. */
export function readAttribution(data: Hex): string[] | null {
  const decoded = fromDataSuffix(data);
  return decoded ? [...decoded.codes] : null;
}

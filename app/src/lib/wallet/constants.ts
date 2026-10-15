// Fixed addresses and limits for passkey Safes. Browser-safe: no env, no db.
// Safe 1.4.1 + Safe4337Module for EntryPoint v0.7, as deployed on Celo mainnet (same CREATE2
// addresses on every chain). permissionless uses these same defaults.
import type { Address } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";

export const SAFE_VERSION = "1.4.1" as const;
export const ENTRY_POINT = { address: entryPoint07Address, version: "0.7" } as const;

export const SAFE_PROXY_FACTORY: Address = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
export const SAFE_SINGLETON: Address = "0x41675C099F32341bf84BFc5382aF534df5C7461a";
export const SAFE_4337_MODULE: Address = "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226";
export const MULTI_SEND_CALL_ONLY: Address = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";
export const WEBAUTHN_SHARED_SIGNER: Address = "0x94a4F6affBd8975951142c3999aEAB7ecee555c2";
export const P256_VERIFIER: Address = "0xA86e0054C51E4894D88762a017ECc5E5235f5DBA";

/** Max total gas (call + verification + pre-verification + paymaster) of one sponsored operation. */
export const MAX_OPERATION_GAS = BigInt(2_000_000);
/** Max fee per gas a sponsored operation may declare (500 gwei; Celo's base fee is ~25 gwei). */
export const MAX_FEE_PER_GAS = BigInt(500_000_000_000);
/** Sponsored operations per Safe per rolling 24 hours. */
export const DAILY_OPERATIONS_PER_SAFE = 30;

/** Sign links (sign_links rows) last this long. The bot sets expiresAt; this is the reference. */
export const SIGN_LINK_TTL_MS = 24 * 60 * 60 * 1000;

export const WARS_DECIMALS = 18;

/** Block explorer base for a chain id, or null for local chains. */
export function explorerTxUrl(chainId: number, txHash: string): string | null {
  if (chainId === 42220) return `https://celoscan.io/tx/${txHash}`;
  if (chainId === 11142220) return `https://celo-sepolia.blockscout.com/tx/${txHash}`;
  return null;
}

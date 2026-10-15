// Production wiring for the wallet module: env, database, chain and Pimlico. Server only.
import type { Address, Hex } from "viem";
import { getDb } from "@/db";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { attributionSuffix } from "@/lib/chain/attribution";
import { addressFromEnv, celoChain, publicClient, resolveChain } from "@/lib/chain/clients";
import { getBudget, getPayment, warsAddress, warsBalanceOf } from "@/lib/chain/treasury";
import { env } from "@/lib/env";
import { passkeySafeAddress, type PasskeyCredential } from "./account";
import { dbLookups, httpForward, type BundlerDeps } from "./bundler";
import { createMemoryRateLimiter } from "./rate-limit";
import type { ChainReader } from "./views";

const rateLimiter = createMemoryRateLimiter();

export function pimlicoUrl(chainId: number, apiKey: string): string {
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${encodeURIComponent(apiKey)}`;
}

function nodeUrl(): string {
  return env().RPC_URL ?? celoChain().rpcUrls.default.http[0];
}

export function treasuryAddress(): Address {
  return addressFromEnv("TREASURY_ADDRESS");
}

export async function isSignerOnChain(safe: Address): Promise<boolean> {
  return publicClient().readContract({
    address: treasuryAddress(),
    abi: treasuryPolicyAbi,
    functionName: "isSigner",
    args: [safe],
  });
}

export async function bundlerDeps(): Promise<BundlerDeps> {
  const db = getDb();
  const chain = await resolveChain();
  const { PIMLICO_API_KEY, PIMLICO_SPONSORSHIP_POLICY_ID } = env();
  return {
    db,
    chainId: chain.id,
    policy: {
      treasury: treasuryAddress(),
      wars: await warsAddress(),
      attributionSuffix: attributionSuffix(),
      isSigner: isSignerOnChain,
      ...dbLookups(db),
    },
    // Pimlico has no local chain; with CHAIN=local operations fail with 503 (reads still work).
    bundler: PIMLICO_API_KEY && env().CHAIN !== "local" ? httpForward(pimlicoUrl(chain.id, PIMLICO_API_KEY)) : null,
    node: httpForward(nodeUrl()),
    rateLimiter,
    sponsorshipPolicyId: PIMLICO_SPONSORSHIP_POLICY_ID,
  };
}

export async function computeSafeAddress(credential: PasskeyCredential): Promise<Address> {
  return passkeySafeAddress(publicClient(), credential);
}

/** What a signing page passes down to its client component. */
export async function pageChainConfig(): Promise<{ chainId: number; rpId: string; attributionSuffix: Hex }> {
  const chain = await resolveChain();
  return { chainId: chain.id, rpId: env().RP_ID, attributionSuffix: attributionSuffix() };
}

export const chainReader: ChainReader = {
  async payment(id) {
    const p = await getPayment(id);
    return { vendor: p.vendor, amount: p.amount, lineId: p.lineId, status: p.status, approvals: p.approvals };
  },
  async budget(lineId) {
    const b = await getBudget(lineId);
    return { allocated: b.allocated, spent: b.spent, exists: b.exists };
  },
  async threshold() {
    return publicClient().readContract({ address: treasuryAddress(), abi: treasuryPolicyAbi, functionName: "threshold" });
  },
  async paused() {
    return publicClient().readContract({ address: treasuryAddress(), abi: treasuryPolicyAbi, functionName: "paused" });
  },
  async hasApproved(id, signer) {
    return publicClient().readContract({
      address: treasuryAddress(),
      abi: treasuryPolicyAbi,
      functionName: "hasApproved",
      args: [id, signer],
    });
  },
  async proposal(id) {
    if (id < BigInt(1)) return null;
    try {
      const [kind, data, proposer, executed, approvals] = await publicClient().readContract({
        address: treasuryAddress(),
        abi: treasuryPolicyAbi,
        functionName: "proposal",
        args: [id],
      });
      if (/^0x0{40}$/i.test(proposer)) return null;
      return { kind, data, proposer, executed, approvals };
    } catch {
      return null; // UnknownProposal
    }
  },
  async hasApprovedProposal(id, signer) {
    return publicClient().readContract({
      address: treasuryAddress(),
      abi: treasuryPolicyAbi,
      functionName: "hasApprovedProposal",
      args: [id, signer],
    });
  },
  async caps() {
    const t = { address: treasuryAddress(), abi: treasuryPolicyAbi } as const;
    const [perTxCap, vendorMonthlyCap] = await Promise.all([
      publicClient().readContract({ ...t, functionName: "perTxCap" }),
      publicClient().readContract({ ...t, functionName: "vendorMonthlyCap" }),
    ]);
    return { perTxCap, vendorMonthlyCap };
  },
  warsBalanceOf,
  async receipt(txHash) {
    return publicClient().getTransactionReceipt({ hash: txHash });
  },
};

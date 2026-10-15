// viem clients for Celo. Every chain call in the app goes through these.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type LocalAccount,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo, celoSepolia } from "viem/chains";
import { env, required } from "@/lib/env";

/** Anvil's default chain id. A local fork of Celo mainnet keeps 42220 instead. */
export const ANVIL_CHAIN_ID = 31337;

const LOCAL_RPC = "http://127.0.0.1:8545";

/**
 * The Celo chain for env().CHAIN, with viem's Celo formatters and CIP-64 serializer.
 * `local` defaults to anvil (31337); pass `chainId` for a local fork (42220).
 * Use `resolveChain()` when the local chain id has to be detected from the node.
 */
export function celoChain(chainId?: number): Chain {
  const { CHAIN, RPC_URL } = env();
  if (CHAIN === "mainnet") return withRpc(celo, RPC_URL);
  if (CHAIN === "sepolia") return withRpc(celoSepolia, RPC_URL);
  return defineChain({
    ...celo,
    id: chainId ?? ANVIL_CHAIN_ID,
    name: "Celo (local)",
    rpcUrls: { default: { http: [RPC_URL ?? LOCAL_RPC] } },
    testnet: true,
  });
}

function withRpc(chain: Chain, rpcUrl: string | undefined): Chain {
  if (!rpcUrl) return chain;
  return { ...chain, rpcUrls: { ...chain.rpcUrls, default: { http: [rpcUrl] } } };
}

function rpcUrl(): string {
  const { RPC_URL } = env();
  return RPC_URL ?? celoChain().rpcUrls.default.http[0];
}

const publicClients = new Map<string, PublicClient>();

/** Read client for the configured chain and RPC. Cached per (CHAIN, RPC_URL). */
export function publicClient(): PublicClient {
  const cacheKey = `${env().CHAIN}|${rpcUrl()}`;
  let client = publicClients.get(cacheKey);
  if (!client) {
    client = createPublicClient({ chain: celoChain(), transport: http(rpcUrl()) }) as PublicClient;
    publicClients.set(cacheKey, client);
  }
  return client;
}

/** The agent's key, from AGENT_PRIVATE_KEY. */
export function agentAccount(): LocalAccount {
  return privateKeyToAccount(required("AGENT_PRIVATE_KEY") as `0x${string}`);
}

const resolvedChains = new Map<string, Chain>();

/**
 * Like celoChain(), but on `local` asks the node for its chain id (anvil 31337 or a fork 42220).
 * Sepolia and mainnet are fixed and returned as is.
 */
export async function resolveChain(): Promise<Chain> {
  if (env().CHAIN !== "local") return celoChain();
  const url = rpcUrl();
  let chain = resolvedChains.get(url);
  if (!chain) {
    chain = celoChain(await publicClient().getChainId());
    resolvedChains.set(url, chain);
  }
  return chain;
}

/** Wallet client that signs with the agent's key on the resolved chain. */
export async function agentWalletClient(): Promise<WalletClient> {
  return createWalletClient({
    account: agentAccount(),
    chain: await resolveChain(),
    transport: http(rpcUrl()),
  });
}

/** Address from env, or a clear error naming the variable. */
export function addressFromEnv(
  key: "TREASURY_ADDRESS" | "BOX_FACTORY_ADDRESS" | "WARS_ADDRESS",
): Address {
  return required(key) as Address;
}

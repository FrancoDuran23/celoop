// Chain helpers for the scripts: transactions from signer/deployer keys (tagged with ERC-8021 like
// everything else) and the forge deploy of contracts/script/Deploy.s.sol.
import { spawn } from "node:child_process";
import path from "node:path";
import {
  createWalletClient,
  http,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { tagClient } from "@/lib/chain/attribution";
import { publicClient, resolveChain } from "@/lib/chain/clients";
import { env } from "@/lib/env";
import { waitMined } from "@/lib/wallet/testing/local-bundler";
import { REPO_DIR } from "./db";
import { LOCAL_RPC } from "./guard";

export const rpcUrl = () => env().RPC_URL ?? LOCAL_RPC;

/**
 * Sends `data` (tagged with the attribution suffix) from `key` and waits for it by polling the
 * receipt. Throws if it reverts. Used for signer and setup transactions, not for the agent's
 * (those go through sendAgentTx).
 */
export async function sendTagged(key: Hex, to: Address, data: Hex): Promise<TransactionReceipt> {
  const account = privateKeyToAccount(key);
  const chain = await resolveChain();
  // Package extension: the suffix is appended inside sendTransaction. Passing raw calldata here
  // is enough; an already-tagged payload would be merged, not doubled.
  const wallet = tagClient(createWalletClient({ account, chain, transport: http(rpcUrl()) }));
  const hash = await wallet.sendTransaction({ account, chain, to, data });
  const receipt = await waitMined(publicClient(), hash);
  if (receipt.status !== "success") throw new Error(`la transacción ${hash} revirtió`);
  return receipt;
}

export type Deployment = {
  chainId: number;
  token: Address;
  factory: Address;
  onchainId?: number;
  treasury: Address;
  boxFactory: Address;
  mockToken: boolean;
};

/** Runs `forge script script/Deploy.s.sol --broadcast` and parses the JSON line it prints. */
export async function forgeDeploy(args: {
  rpcUrl: string;
  /** Variables for the script; `undefined` removes one inherited from this process. */
  env: Record<string, string | undefined>;
  log?: (s: string) => void;
}): Promise<Deployment> {
  const contracts = path.join(REPO_DIR, "contracts");
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(args.env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  const forgeArgs = ["exec", "--", "forge", "script", "script/Deploy.s.sol:Deploy", "--rpc-url", args.rpcUrl, "--broadcast", "--slow"];
  const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("mise", forgeArgs, {
      cwd: contracts,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  if (code !== 0) throw new Error(`forge script falló (código ${code}):\n${stdout}\n${stderr}`);
  const line = stdout
    .split("\n")
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith("{") && l.includes('"treasury"'));
  if (!line) throw new Error(`forge script no imprimió el resultado del deploy:\n${stdout}`);
  const d = JSON.parse(line) as Deployment;
  args.log?.(`Contratos desplegados: factory ${d.factory}, tesoro ${d.treasury}, buzones ${d.boxFactory}, wARS ${d.token}${d.mockToken ? " (MockWARS)" : ""}`);
  return d;
}

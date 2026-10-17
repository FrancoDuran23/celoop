// Points an existing ERC-8004 identity at a new registration URI (setAgentURI).
// The card at APP_URL/agent.json already updates when AGENT_ID changes, so this is only needed
// when the URL itself changes. The transaction goes through sendAgentTx and carries the ERC-8021 suffix.
// --dry-run simulates and does not broadcast. Off local, --yes is still required to reach the node.
import { encodeFunctionData, keccak256, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Db } from "@/db";
import { sendAgentTx } from "@/lib/chain/agent";
import { agentAccount, auditorAccount, publicClient } from "@/lib/chain/clients";
import { agentCardUri, identityRegistryAbi, registryFor, type AgentRole } from "@/lib/erc8004";
import { resetEnv } from "@/lib/env";
import { openScriptDb } from "./db";
import { chainName, checkNode, LOCAL_RPC, safetyCut } from "./guard";

export type UpdateUriOptions = {
  yes?: boolean;
  dryRun?: boolean;
  role?: AgentRole;
  /** Defaults to APP_URL/agent.json or APP_URL/auditor.json. */
  uri?: string;
  env?: Record<string, string | undefined>;
  db?: Db;
  log?: (s: string) => void;
};

export type UpdateUriResult =
  | { status: "refused" | "needs-confirmation" | "dry-run"; message: string }
  | { status: "updated"; agentId: bigint; txHash: Hex; agentURI: string };

export async function updateAgentUri(opts: UpdateUriOptions = {}): Promise<UpdateUriResult> {
  const log = opts.log ?? console.log;
  const e = { ...process.env, ...(opts.env ?? {}) };
  const get = (k: string) => (e[k]?.trim() ? e[k]!.trim() : undefined);
  const chain = chainName(get("CHAIN"));
  const rpcUrl = get("RPC_URL") ?? (chain === "local" ? LOCAL_RPC : undefined);
  const role = opts.role ?? "treasurer";
  const keyVar = role === "auditor" ? "AUDITOR_PRIVATE_KEY" : "AGENT_PRIVATE_KEY";
  const idVar = role === "auditor" ? "AUDITOR_ID" : "AGENT_ID";
  const agentKey = get(keyVar) as Hex | undefined;
  if (!agentKey) throw new Error(`Falta ${keyVar}: setAgentURI lo manda el dueño de la identidad.`);
  const agent = privateKeyToAccount(agentKey).address;
  const appUrl = get("APP_URL") ?? "http://localhost:3000";
  const agentURI = opts.uri?.trim() || agentCardUri(appUrl, role);
  const idRaw = get(idVar);
  const attributionCode = get("ATTRIBUTION_CODE");

  log(`setAgentURI del ${role === "auditor" ? "auditor" : "agente tesorero"} ${agent}`);
  log(`  Red: ${chain} · RPC ${rpcUrl ?? "(falta RPC_URL)"}`);
  log(`  ${idVar}: ${idRaw ?? "(falta)"}`);
  log(`  Nueva URI: ${agentURI}`);

  const decision = safetyCut({ chain, yes: opts.yes ?? false, attributionCode });
  if (decision.action !== "proceed") {
    log(`\n${decision.message}`);
    return { status: decision.action === "refuse" ? "refused" : "needs-confirmation", message: decision.message };
  }
  if (!idRaw || !/^\d+$/.test(idRaw)) throw new Error(`Falta ${idVar} (el número que imprimió register-agent).`);
  if (!rpcUrl) throw new Error(`Falta RPC_URL para CHAIN=${chain}.`);
  const agentId = BigInt(idRaw);

  resetEnv({
    CHAIN: chain,
    RPC_URL: rpcUrl,
    [keyVar]: agentKey,
    ATTRIBUTION_CODE: attributionCode ?? "",
    AGENT_SEND: opts.dryRun ? "off" : "on",
    FEE_CURRENCY: get("FEE_CURRENCY") ?? "",
  });
  const chainId = await checkNode(chain, rpcUrl);
  const registry = (get("IDENTITY_REGISTRY") as Address | undefined) ?? registryFor(chainId);
  if (!registry) {
    throw new Error(`No hay Identity Registry conocido para el chain ${chainId}. Pasá IDENTITY_REGISTRY.`);
  }
  const client = publicClient();
  if (!(await client.getCode({ address: registry }))) throw new Error(`No hay contrato en ${registry} en el chain ${chainId}.`);
  log(`  Identity Registry: ${registry} (chain ${chainId})`);

  const handle = await openScriptDb({ db: opts.db, databaseUrl: get("DATABASE_URL"), log });
  try {
    const data = encodeFunctionData({ abi: identityRegistryAbi, functionName: "setAgentURI", args: [agentId, agentURI] });
    const key = `erc8004:set-uri:${role}:${chainId}:${agentId}:${keccak256(toHex(agentURI))}`;
    const account = role === "auditor" ? auditorAccount() : agentAccount();
    const sent = await sendAgentTx({ key, kind: "register", to: registry, data }, { db: handle.db, account });
    if ("dryRun" in sent) {
      const message = "Simulación OK: setAgentURI saldría bien. No se envió nada (--dry-run).";
      log(message);
      return { status: "dry-run", message };
    }
    log(`URI actualizada: agentId ${agentId} → ${agentURI} (tx ${sent.txHash}).`);
    return { status: "updated", agentId, txHash: sent.txHash, agentURI };
  } finally {
    await handle.close();
  }
}

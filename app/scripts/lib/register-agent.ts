// ERC-8004: registers the agent in the Identity Registry.
// The treasurer and the auditor are two agents with two identities: `role: "auditor"` registers
// the auditor with its own key (AUDITOR_PRIVATE_KEY).
//
// The on-chain URI is APP_URL/agent.json (or /auditor.json). The Next app serves that card from
// env (APP_URL, AGENT_ID / AUDITOR_ID, the wallet). The id does not exist until this transaction
// is mined, so the card's `registrations` array stays empty until that env var is set. The URI
// itself does not change, so setAgentURI is only needed when the URL changes
// (scripts/update-agent-uri.ts). A snapshot of the file, with the id filled in, is written locally.
//
// IdentityRegistry.register(string agentURI) returns (uint256 agentId). The id is read from the
// Registered event: the return value is only a simulation-time guess. The transaction goes through
// sendAgentTx, so it carries the ERC-8021 suffix.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { decodeEventLog, encodeFunctionData, isAddressEqual, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Db } from "@/db";
import { agentTxs, cooperadora } from "@/db/schema";
import { sendAgentTx } from "@/lib/chain/agent";
import { agentAccount, auditorAccount } from "@/lib/chain/clients";
import { publicClient } from "@/lib/chain/clients";
import {
  agentCardUri,
  cardPath,
  describeAgent,
  identityRegistryAbi,
  IDENTITY_REGISTRY,
  type AgentRole,
  type RegistrationFile,
  registrationFile,
  REGISTRATION_TYPE,
} from "@/lib/erc8004";
import { resetEnv } from "@/lib/env";
import { APP_DIR, openScriptDb } from "./db";
import { chainName, checkNode, LOCAL_RPC, safetyCut } from "./guard";

export { IDENTITY_REGISTRY, REGISTRATION_TYPE, identityRegistryAbi, registrationFile };
export type { AgentRole, RegistrationFile };

export const DEFAULT_REGISTRATION_FILE = path.join(APP_DIR, "public/agent-registration.json");
export const AUDITOR_REGISTRATION_FILE = path.join(APP_DIR, "public/auditor-registration.json");

const ROLE = {
  treasurer: { keyVar: "AGENT_PRIVATE_KEY", idVar: "AGENT_ID", nameVar: "AGENT_NAME", descriptionVar: "AGENT_DESCRIPTION" },
  auditor: { keyVar: "AUDITOR_PRIVATE_KEY", idVar: "AUDITOR_ID", nameVar: "AUDITOR_NAME", descriptionVar: "AUDITOR_DESCRIPTION" },
} as const;

export type RegisterOptions = {
  yes?: boolean;
  /** Simulate only (AGENT_SEND off). */
  dryRun?: boolean;
  /** Register again even if the agent already owns an identity. */
  force?: boolean;
  /** Which of the two agents. Default: the treasurer. */
  role?: AgentRole;
  env?: Record<string, string | undefined>;
  db?: Db;
  outFile?: string;
  log?: (s: string) => void;
};

export type RegisterResult =
  | { status: "refused" | "needs-confirmation" | "already-registered" | "dry-run"; message: string; file?: RegistrationFile }
  | { status: "registered"; agentId: bigint; txHash: Hex; agentURI: string; file: RegistrationFile; outFile: string };

export async function registerAgent(opts: RegisterOptions = {}): Promise<RegisterResult> {
  const log = opts.log ?? console.log;
  const e = { ...process.env, ...(opts.env ?? {}) };
  const get = (k: string) => (e[k]?.trim() ? e[k]!.trim() : undefined);
  const chain = chainName(get("CHAIN"));
  const rpcUrl = get("RPC_URL") ?? (chain === "local" ? LOCAL_RPC : undefined);
  const role = opts.role ?? "treasurer";
  const r = ROLE[role];
  const agentKey = get(r.keyVar) as Hex | undefined;
  if (!agentKey) throw new Error(`Falta ${r.keyVar}: la identidad queda a nombre de esa cuenta.`);
  const agent = privateKeyToAccount(agentKey).address;
  const appUrl = get("APP_URL") ?? "http://localhost:3000";
  const agentURI = agentCardUri(appUrl, role);
  const attributionCode = get("ATTRIBUTION_CODE");

  log(`Registro ERC-8004 del ${role === "auditor" ? "auditor" : "agente tesorero"} ${agent}`);
  log(`  Red: ${chain} · RPC ${rpcUrl ?? "(falta RPC_URL)"}`);
  log(`  URI del registro: ${agentURI}`);

  const decision = safetyCut({ chain, yes: opts.yes ?? false, attributionCode });
  if (decision.action !== "proceed") {
    log(`\n${decision.message}`);
    return { status: decision.action === "refuse" ? "refused" : "needs-confirmation", message: decision.message };
  }
  if (!rpcUrl) throw new Error(`Falta RPC_URL para CHAIN=${chain}.`);

  resetEnv({
    CHAIN: chain,
    RPC_URL: rpcUrl,
    [r.keyVar]: agentKey,
    ATTRIBUTION_CODE: attributionCode ?? "",
    AGENT_SEND: opts.dryRun ? "off" : "on",
    FEE_CURRENCY: get("FEE_CURRENCY") ?? "",
  });
  const chainId = await checkNode(chain, rpcUrl);
  const registry = (get("IDENTITY_REGISTRY") as Address | undefined) ?? IDENTITY_REGISTRY[chainId];
  if (!registry) {
    throw new Error(`No hay Identity Registry conocido para el chain ${chainId}. Usá un fork de Celo (anvil --fork-url https://forno.celo.org) o IDENTITY_REGISTRY.`);
  }
  const client = publicClient();
  if (!(await client.getCode({ address: registry }))) throw new Error(`No hay contrato en ${registry} en el chain ${chainId}.`);
  log(`  Identity Registry: ${registry} (chain ${chainId})`);

  const handle = await openScriptDb({ db: opts.db, databaseUrl: get("DATABASE_URL"), log });
  try {
    const [coop] = await handle.db.select().from(cooperadora).catch(() => []);
    const copy = describeAgent(role, coop ? { name: coop.name, school: coop.school } : null);
    const name = get(r.nameVar) ?? copy.name;
    const description = get(r.descriptionVar) ?? copy.description;
    const fileArgs = {
      name,
      description,
      appUrl,
      agent,
      chainId,
      registry,
      telegramBot: get("TELEGRAM_BOT_USERNAME"),
      attributionCode,
    };
    const outFile = opts.outFile ?? (role === "auditor" ? AUDITOR_REGISTRATION_FILE : DEFAULT_REGISTRATION_FILE);
    const write = (file: RegistrationFile) => {
      mkdirSync(path.dirname(outFile), { recursive: true });
      writeFileSync(outFile, `${JSON.stringify(file, null, 2)}\n`);
    };

    // The treasurer keeps the key it always had; the auditor gets its own.
    const key = `register:erc8004:${role === "auditor" ? "auditor:" : ""}${chainId}:${registry.toLowerCase()}`;
    const owned = await client.readContract({ address: registry, abi: identityRegistryAbi, functionName: "balanceOf", args: [agent] });
    if (owned > BigInt(0) && !opts.force) {
      const [row] = await handle.db.select().from(agentTxs).where(eq(agentTxs.key, key));
      if (!row || row.status !== "mined") {
        const message = `El agente ya tiene ${owned} identidad(es) en ${registry} y esta base no la tiene registrada. Usá --force para registrar otra.`;
        log(message);
        return { status: "already-registered", message };
      }
    }

    const preliminary = registrationFile(fileArgs);
    write(preliminary);
    const data = encodeFunctionData({ abi: identityRegistryAbi, functionName: "register", args: [agentURI] });
    const account = role === "auditor" ? auditorAccount() : agentAccount();
    const sent = await sendAgentTx({ key, kind: "register", to: registry, data }, { db: handle.db, account });
    if ("dryRun" in sent) {
      const message = "Simulación OK: el registro saldría bien. No se envió nada (--dry-run).";
      log(message);
      return { status: "dry-run", message, file: preliminary };
    }

    let agentId: bigint | undefined;
    for (const l of sent.receipt.logs) {
      if (!isAddressEqual(l.address, registry)) continue;
      try {
        const ev = decodeEventLog({ abi: identityRegistryAbi, data: l.data, topics: l.topics });
        if (ev.eventName === "Registered" && isAddressEqual(ev.args.owner, agent)) agentId = ev.args.agentId;
      } catch {
        // Transfer and other events
      }
    }
    if (agentId === undefined) throw new Error(`La transacción ${sent.txHash} no emitió Registered para el agente.`);

    const file = registrationFile({ ...fileArgs, agentId });
    write(file);
    log(`Agente registrado: agentId ${agentId} (tx ${sent.txHash}).`);
    log(`Copia local del registro (con el id): ${outFile}.`);
    log(`La app sirve la tarjeta en ${agentURI}. Poné esto en el entorno y reiniciá:`);
    log(`${r.idVar}=${agentId}`);
    log(`Hasta entonces ${cardPath(role)} no incluye registrations. La URI no cambia, así que no hace falta setAgentURI.`);
    return { status: "registered", agentId, txHash: sent.txHash, agentURI, file, outFile };
  } finally {
    await handle.close();
  }
}

// ERC-8004: registers the agent in the Identity Registry and writes its registration file.
//
// Format verified against EIP-8004 (eips.ethereum.org/EIPS/eip-8004) and
// docs.celo.org/build-on-celo/build-with-ai/8004:
//   - IdentityRegistry.register(string agentURI) returns (uint256 agentId); it mints the identity
//     NFT to msg.sender and emits Registered(agentId, agentURI, owner). The agent id is read from
//     the event (the return value is only a simulation-time guess).
//   - The registration file has type "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
//     name, description, image, services [{name, endpoint, version?}], x402Support, active,
//     registrations [{agentId, agentRegistry: "eip155:<chainId>:<registry>"}] and the optional
//     supportedTrust. The id only exists after registering, so the file is written twice. The URI
//     stays the same (APP_URL/agent-registration.json), so no setAgentURI is needed.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { decodeEventLog, encodeFunctionData, isAddressEqual, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Db } from "@/db";
import { agentTxs, cooperadora } from "@/db/schema";
import { sendAgentTx } from "@/lib/chain/agent";
import { publicClient } from "@/lib/chain/clients";
import { resetEnv } from "@/lib/env";
import { APP_DIR, openScriptDb } from "./db";
import { chainName, checkNode, EXPECTED_CHAIN_ID, LOCAL_RPC, safetyCut } from "./guard";

export const IDENTITY_REGISTRY: Record<number, Address> = {
  [EXPECTED_CHAIN_ID.mainnet]: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  [EXPECTED_CHAIN_ID.sepolia]: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
};

export const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
export const DEFAULT_REGISTRATION_FILE = path.join(APP_DIR, "public/agent-registration.json");

export const identityRegistryAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export type RegistrationFile = {
  type: string;
  name: string;
  description: string;
  image: string;
  services: { name: string; endpoint: string; version?: string }[];
  x402Support: boolean;
  active: boolean;
  registrations: { agentId: number; agentRegistry: string }[];
};

const base = (url: string) => url.replace(/\/+$/, "");

export function registrationFile(args: {
  name: string;
  description: string;
  appUrl: string;
  agent: Address;
  chainId: number;
  registry: Address;
  agentId?: bigint;
  telegramBot?: string;
}): RegistrationFile {
  const app = base(args.appUrl);
  const services: RegistrationFile["services"] = [{ name: "web", endpoint: `${app}/` }];
  if (args.telegramBot) services.push({ name: "telegram", endpoint: `https://t.me/${args.telegramBot.replace(/^@/, "")}` });
  services.push({ name: "agentWallet", endpoint: `eip155:${args.chainId}:${args.agent}` });
  return {
    type: REGISTRATION_TYPE,
    name: args.name,
    description: args.description,
    image: `${app}/favicon.ico`,
    services,
    x402Support: false,
    active: true,
    registrations:
      args.agentId === undefined ? [] : [{ agentId: Number(args.agentId), agentRegistry: `eip155:${args.chainId}:${args.registry}` }],
  };
}

export type RegisterOptions = {
  yes?: boolean;
  /** Simulate only (AGENT_SEND off). */
  dryRun?: boolean;
  /** Register again even if the agent already owns an identity. */
  force?: boolean;
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
  const agentKey = get("AGENT_PRIVATE_KEY") as Hex | undefined;
  if (!agentKey) throw new Error("Falta AGENT_PRIVATE_KEY: la identidad queda a nombre de la cuenta del agente.");
  const agent = privateKeyToAccount(agentKey).address;
  const appUrl = get("APP_URL") ?? "http://localhost:3000";
  const agentURI = `${base(appUrl)}/agent-registration.json`;
  const attributionCode = get("ATTRIBUTION_CODE");

  log(`Registro ERC-8004 del agente ${agent}`);
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
    AGENT_PRIVATE_KEY: agentKey,
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
    const name = get("AGENT_NAME") ?? (coop ? `Tesorero de ${coop.name}` : "Cooperadora Abierta");
    const description =
      get("AGENT_DESCRIPTION") ??
      `Agente tesorero${coop ? ` de ${coop.name} (${coop.school})` : " de una cooperadora escolar argentina"}. ` +
        "Lee las facturas que carga la comisión, paga a proveedores habilitados dentro de las reglas del contrato " +
        "(lo que las excede lo firman las personas), recibe los aportes de los socios en wARS y publica la rendición mensual. " +
        "Se usa por Telegram.";
    const fileArgs = { name, description, appUrl, agent, chainId, registry, telegramBot: get("TELEGRAM_BOT_USERNAME") };
    const outFile = opts.outFile ?? DEFAULT_REGISTRATION_FILE;
    const write = (file: RegistrationFile) => {
      mkdirSync(path.dirname(outFile), { recursive: true });
      writeFileSync(outFile, `${JSON.stringify(file, null, 2)}\n`);
    };

    const key = `register:erc8004:${chainId}:${registry.toLowerCase()}`;
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
    const sent = await sendAgentTx({ key, kind: "register", to: registry, data }, { db: handle.db });
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
    log(`Archivo de registro: ${outFile}. Publicalo en ${agentURI} (va en app/public).`);
    log(`AGENT_ID=${agentId}`);
    return { status: "registered", agentId, txHash: sent.txHash, agentURI, file, outFile };
  } finally {
    await handle.close();
  }
}

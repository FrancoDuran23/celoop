// ERC-8004 registration file for the treasurer and the auditor.
// Registry addresses: https://docs.celo.org/build-on-celo/build-with-ai/8004
//   Celo mainnet Identity Registry 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
//   Celo Sepolia Identity Registry 0x8004A818BFB912233c491871b3d84c89A494BD9e
// The same mainnet address is what alcancia registers against.
// The file shape follows the registration-v1 example on that page and EIP-8004.
import { privateKeyToAccount } from "viem/accounts";
import { parseAbi, type Address, type Hex } from "viem";
import { APP_NAME } from "@/lib/brand";
import { env } from "@/lib/env";

export const CELO_MAINNET_IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
export const CELO_SEPOLIA_IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;

export const IDENTITY_REGISTRY: Record<number, Address> = {
  42220: CELO_MAINNET_IDENTITY_REGISTRY,
  11142220: CELO_SEPOLIA_IDENTITY_REGISTRY,
};

export const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

/** Path served by the Next app (rewrite to the card route). */
export const AGENT_CARD_PATH = "/agent.json";
export const AUDITOR_CARD_PATH = "/auditor.json";

export const identityRegistryAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function setAgentURI(uint256 agentId, string newURI)",
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export type AgentRole = "treasurer" | "auditor";

export type RegistrationFile = {
  type: string;
  name: string;
  description: string;
  image: string;
  services: { name: string; endpoint: string; version?: string }[];
  x402Support: boolean;
  active: boolean;
  registrations: { agentId: number; agentRegistry: string }[];
  supportedTrust: string[];
  "x-attribution"?: string[];
};

const base = (url: string) => url.replace(/\/+$/, "");

/** Chain id the public card describes. Local follows mainnet: the fork keeps 42220, and that is where the identity lives. */
export function erc8004ChainId(chain: "local" | "sepolia" | "mainnet"): number {
  return chain === "sepolia" ? 11142220 : 42220;
}

export function registryFor(chainId: number, override?: Address): Address | undefined {
  return override ?? IDENTITY_REGISTRY[chainId];
}

export function describeAgent(role: AgentRole, coop?: { name: string; school: string } | null): { name: string; description: string } {
  const of = coop ? ` de ${coop.name} (${coop.school})` : " de una cooperadora escolar argentina";
  if (role === "auditor") {
    return {
      name: coop ? `Auditor de ${coop.name}` : `${APP_NAME} (auditor)`,
      description:
        `Agente auditor${of}. Revisa cada pago que propone el agente tesorero antes de que salga: vuelve a leer el QR de la factura, ` +
        "compara el archivo y el monto con lo que está en el contrato y busca compras partidas o facturas repetidas. " +
        "Con su propia clave solo puede aprobar u observar un pago: lo observado lo deciden las personas que firman. " +
        "Una vez por día verifica que el saldo del tesoro coincida con los movimientos registrados. Publica un informe por pago.",
    };
  }
  return {
    name: coop ? `Tesorero de ${coop.name}` : APP_NAME,
    description:
      `Agente tesorero${of}. ` +
      "Lee las facturas que carga la comisión, paga a proveedores habilitados dentro de las reglas del contrato " +
      "(lo que las excede lo firman las personas, y lo chico lo revisa antes el agente auditor), recibe los aportes de los socios en wARS y publica la rendición mensual. " +
      "Se usa por Telegram.",
  };
}

export function registrationFile(args: {
  name: string;
  description: string;
  appUrl: string;
  agent?: Address;
  chainId: number;
  registry: Address;
  agentId?: bigint;
  telegramBot?: string;
  attributionCode?: string;
}): RegistrationFile {
  const app = base(args.appUrl);
  const services: RegistrationFile["services"] = [{ name: "web", endpoint: `${app}/` }];
  if (args.telegramBot) services.push({ name: "telegram", endpoint: `https://t.me/${args.telegramBot.replace(/^@/, "")}` });
  if (args.agent) services.push({ name: "agentWallet", endpoint: `eip155:${args.chainId}:${args.agent}` });
  const file: RegistrationFile = {
    type: REGISTRATION_TYPE,
    name: args.name,
    description: args.description,
    image: `${app}/og.jpg`,
    services,
    x402Support: false,
    active: true,
    registrations:
      args.agentId === undefined ? [] : [{ agentId: Number(args.agentId), agentRegistry: `eip155:${args.chainId}:${args.registry}` }],
    supportedTrust: ["reputation"],
  };
  if (args.attributionCode) file["x-attribution"] = [args.attributionCode];
  return file;
}

export function cardPath(role: AgentRole): string {
  return role === "auditor" ? AUDITOR_CARD_PATH : AGENT_CARD_PATH;
}

export function agentCardUri(appUrl: string, role: AgentRole): string {
  return `${base(appUrl)}${cardPath(role)}`;
}

function addressFromKey(key: string | undefined): Address | undefined {
  if (!key) return undefined;
  return privateKeyToAccount(key as Hex).address;
}

/** The card the app serves. URLs come from APP_URL. The agent id comes from AGENT_ID / AUDITOR_ID. */
export function agentCardFromEnv(role: AgentRole): RegistrationFile {
  const e = env();
  const chainId = erc8004ChainId(e.CHAIN);
  const registry = registryFor(chainId, e.IDENTITY_REGISTRY as Address | undefined);
  if (!registry) throw new Error(`No Identity Registry for chain ${chainId}.`);
  const copy = describeAgent(role);
  const name = (role === "auditor" ? e.AUDITOR_NAME : e.AGENT_NAME) ?? copy.name;
  const description = (role === "auditor" ? e.AUDITOR_DESCRIPTION : e.AGENT_DESCRIPTION) ?? copy.description;
  const key = role === "auditor" ? e.AUDITOR_PRIVATE_KEY : e.AGENT_PRIVATE_KEY;
  const fallback = (role === "auditor" ? e.AUDITOR_ADDRESS : e.AGENT_ADDRESS) as Address | undefined;
  const agent = addressFromKey(key) ?? fallback;
  const idRaw = role === "auditor" ? e.AUDITOR_ID : e.AGENT_ID;
  return registrationFile({
    name,
    description,
    appUrl: e.APP_URL,
    agent,
    chainId,
    registry,
    agentId: idRaw ? BigInt(idRaw) : undefined,
    telegramBot: e.TELEGRAM_BOT_USERNAME,
    attributionCode: e.ATTRIBUTION_CODE,
  });
}

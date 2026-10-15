// Safety cut shared by the scripts that send transactions (setup, register-agent):
//   - CHAIN=local only talks to an anvil on this machine.
//   - Any other CHAIN stops before sending anything: it shows the plan and needs --yes.
//   - mainnet also needs ATTRIBUTION_CODE (the hackathon cannot backfill untagged transactions).
// Nothing here sends a transaction.

export type ChainName = "local" | "sepolia" | "mainnet";

export const EXPECTED_CHAIN_ID: Record<Exclude<ChainName, "local">, number> = {
  sepolia: 11142220,
  mainnet: 42220,
};

export const LOCAL_RPC = "http://127.0.0.1:8545";

export type SafetyDecision =
  | { action: "proceed" }
  | { action: "confirm"; message: string }
  | { action: "refuse"; message: string };

export function chainName(value: string | undefined): ChainName {
  const v = (value ?? "local").trim() || "local";
  if (v !== "local" && v !== "sepolia" && v !== "mainnet") throw new Error(`CHAIN tiene que ser local, sepolia o mainnet (vino "${v}")`);
  return v;
}

/** What the script may do before sending anything. Pure: no I/O. */
export function safetyCut(args: { chain: ChainName; yes: boolean; attributionCode?: string }): SafetyDecision {
  if (args.chain === "mainnet" && !args.attributionCode?.trim()) {
    return {
      action: "refuse",
      message: "En mainnet hace falta ATTRIBUTION_CODE: todas las transacciones llevan el tag ERC-8021 desde la primera.",
    };
  }
  if (args.chain !== "local" && !args.yes) {
    return {
      action: "confirm",
      message: `CHAIN=${args.chain}: no se envió nada. Revisá el plan de arriba y, si está bien, volvé a correr con --yes.`,
    };
  }
  return { action: "proceed" };
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

async function rpc<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as T;
}

/**
 * Checks that the node is the one CHAIN says: on local, an anvil on loopback (plain or a fork);
 * on sepolia/mainnet, the right chain id. Returns the chain id. Reads only.
 */
export async function checkNode(chain: ChainName, rpcUrl: string): Promise<number> {
  if (chain === "local") {
    const host = new URL(rpcUrl).hostname;
    if (!LOOPBACK.has(host)) {
      throw new Error(`CHAIN=local solo habla con un anvil en esta máquina, y RPC_URL apunta a ${host}.`);
    }
    const version = await rpc<string>(rpcUrl, "web3_clientVersion").catch(() => "");
    if (!/anvil/i.test(version)) throw new Error(`El nodo en ${rpcUrl} no es anvil (${version || "sin respuesta"}).`);
  }
  const chainId = Number(BigInt(await rpc<string>(rpcUrl, "eth_chainId")));
  if (chain !== "local" && chainId !== EXPECTED_CHAIN_ID[chain]) {
    throw new Error(`CHAIN=${chain} espera el chain id ${EXPECTED_CHAIN_ID[chain]} y el nodo devolvió ${chainId}.`);
  }
  return chainId;
}

/** Command-line flags: --yes, --dry-run, etc. Everything else is a positional argument. */
export function parseArgs(argv: string[]): { flags: Set<string>; positional: string[] } {
  const flags = new Set<string>();
  const positional: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--")) flags.add(a.slice(2));
    else positional.push(a);
  }
  return { flags, positional };
}

// Test helper: starts a throwaway anvil on a free port (via mise, as pinned in mise.toml).
// Never used by the app itself.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";

export const REPO_ROOT = path.resolve(__dirname, "../../../..");

/** anvil's well-known dev accounts (mnemonic "test test ... junk"). Local use only. */
export const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
] as const;

/** anvil's dev account #6, the local auditor (0x976EA74026E726554dB657fA54763abd0C3a0aa9). Local use only. */
export const ANVIL_AUDITOR_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" as const;

export type Anvil = { url: string; port: number; stop: () => Promise<void> };

export function anvilAvailable(): boolean {
  try {
    return spawnSync("mise", ["exec", "--", "anvil", "--version"], { cwd: REPO_ROOT, timeout: 30_000 }).status === 0;
  } catch {
    return false;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

async function rpcReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startAnvil(extraArgs: string[] = []): Promise<Anvil> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(
    "mise",
    ["exec", "--", "anvil", "--port", String(port), "--silent", ...extraArgs],
    { cwd: REPO_ROOT, stdio: "ignore" },
  );
  const deadline = Date.now() + 30_000;
  while (!(await rpcReady(url))) {
    if (child.exitCode !== null) throw new Error(`anvil exited with code ${child.exitCode}`);
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error("anvil did not start within 30 s");
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    url,
    port,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}

/** Raw JSON-RPC call, for anvil_* / evm_* test methods. */
export async function anvilRpc<T = unknown>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as T;
}

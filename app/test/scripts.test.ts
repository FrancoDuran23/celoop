// The operator scripts: the safety cut (nothing leaves anvil without --yes; mainnet needs
// ATTRIBUTION_CODE), setup.ts against a clean local anvil, and the Telegram webhook script.
// The ERC-8004 registration is exercised against the Celo fork in e2e.test.ts.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { keccak256, toHex, type Hex } from "viem";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { budgetLines, cooperadora, persons, vendors } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { anvilAvailable, anvilRpc, startAnvil, type Anvil } from "@/lib/chain/anvil";
import { readAttribution } from "@/lib/chain/attribution";
import { publicClient } from "@/lib/chain/clients";
import { buildPlan, endOfArDay, loadConfig } from "../scripts/lib/config";
import { checkNode, safetyCut } from "../scripts/lib/guard";
import { registerAgent } from "../scripts/lib/register-agent";
import { runSetup } from "../scripts/lib/setup";
import { setTelegramWebhook, webhookUrl } from "../scripts/lib/telegram-webhook";

// Spy on child processes (forge) without changing what they do.
vi.mock("node:child_process", async (importOriginal) => {
  const m = await importOriginal<typeof import("node:child_process")>();
  return { ...m, spawn: vi.fn(m.spawn), spawnSync: vi.fn(m.spawnSync) };
});
const childProcess = await import("node:child_process");
const forgeRuns = () =>
  vi.mocked(childProcess.spawn).mock.calls.filter(([, args]) => (args as string[] | undefined)?.includes("forge")).length;

const DEMO = path.resolve(__dirname, "../scripts/config/demo.json");
const AGENT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex; // anvil #1
const quiet = () => {};

describe("safety cut", () => {
  test("local proceeds; sepolia and mainnet need --yes; mainnet also needs ATTRIBUTION_CODE", () => {
    expect(safetyCut({ chain: "local", yes: false })).toEqual({ action: "proceed" });
    expect(safetyCut({ chain: "sepolia", yes: false }).action).toBe("confirm");
    expect(safetyCut({ chain: "sepolia", yes: true })).toEqual({ action: "proceed" });
    expect(safetyCut({ chain: "mainnet", yes: false, attributionCode: "code" }).action).toBe("confirm");
    expect(safetyCut({ chain: "mainnet", yes: true }).action).toBe("refuse");
    expect(safetyCut({ chain: "mainnet", yes: true, attributionCode: " " }).action).toBe("refuse");
    expect(safetyCut({ chain: "mainnet", yes: true, attributionCode: "code" })).toEqual({ action: "proceed" });
  });

  describe("the scripts send nothing without confirmation", () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("no network in this test");
    });
    beforeAll(() => vi.stubGlobal("fetch", fetchSpy));
    afterAll(() => vi.unstubAllGlobals());
    afterEach(() => fetchSpy.mockClear());

    const env = (over: Record<string, string | undefined>) => ({
      RPC_URL: "https://rpc.invalid",
      DEPLOYER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      AGENT_PRIVATE_KEY: AGENT_KEY,
      ATTRIBUTION_CODE: undefined,
      DATABASE_URL: undefined,
      ...over,
    });

    test("setup on sepolia without --yes prints the plan and stops", async () => {
      const log: string[] = [];
      const forgeBefore = forgeRuns();
      const r = await runSetup({ configPath: DEMO, env: env({ CHAIN: "sepolia" }), log: (s) => log.push(s) });
      expect(r.status).toBe("needs-confirmation");
      expect(log.join("\n")).toContain("Habilitar proveedor Librería Don Pepe");
      expect(log.join("\n")).toContain("--yes");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(forgeRuns()).toBe(forgeBefore);
    });

    test("setup on mainnet without ATTRIBUTION_CODE is refused, even with --yes", async () => {
      const forgeBefore = forgeRuns();
      const r = await runSetup({ configPath: DEMO, yes: true, env: env({ CHAIN: "mainnet" }), log: quiet });
      expect(r.status).toBe("refused");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(forgeRuns()).toBe(forgeBefore);
    });

    test("setup on mainnet with the code still needs --yes", async () => {
      const r = await runSetup({ configPath: DEMO, env: env({ CHAIN: "mainnet", ATTRIBUTION_CODE: "code" }), log: quiet });
      expect(r.status).toBe("needs-confirmation");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("CHAIN=local refuses a node that is not on this machine", async () => {
      const forgeBefore = forgeRuns();
      await expect(
        runSetup({ configPath: DEMO, env: env({ CHAIN: "local", RPC_URL: "https://forno.celo.org" }), log: quiet }),
      ).rejects.toThrow(/solo habla con un anvil/);
      await expect(checkNode("local", "https://forno.celo.org")).rejects.toThrow(/solo habla con un anvil/);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(forgeRuns()).toBe(forgeBefore);
    });

    test("register-agent has the same cut", async () => {
      expect((await registerAgent({ env: env({ CHAIN: "sepolia" }), log: quiet })).status).toBe("needs-confirmation");
      expect((await registerAgent({ env: env({ CHAIN: "mainnet" }), log: quiet, yes: true })).status).toBe("refused");
      expect(
        (await registerAgent({ env: env({ CHAIN: "mainnet", ATTRIBUTION_CODE: "code" }), log: quiet })).status,
      ).toBe("needs-confirmation");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

describe("config", () => {
  test("the demo config has the six budget lines, an operador and lineId = keccak256(slug)", () => {
    const { config, baseDir } = loadConfig(DEMO);
    const plan = buildPlan(config, baseDir, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    expect(plan.lines.map((l) => l.slug)).toEqual(["materiales", "mantenimiento", "comedor", "eventos", "imprevistos", "gastos-operativos"]);
    expect(plan.lines[0].lineId).toBe(keccak256(toHex("materiales")));
    expect(config.people.some((p) => p.roles.includes("operador"))).toBe(true);
    expect(plan.signers).toHaveLength(3);
    expect(plan.proposals.map((p) => p.kind)).toEqual([...Array(6).fill("SetBudget"), "SetVendor"]);
  });

  test("periodEnd is the last second of that day in Argentina", () => {
    expect(new Date(Number(endOfArDay("2026-12-31")) * 1000).toISOString()).toBe("2027-01-01T02:59:59.000Z");
  });

  test("an agent that is also a signer is rejected", () => {
    const { config, baseDir } = loadConfig(DEMO);
    expect(() => buildPlan(config, baseDir, "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC")).toThrow(/agente no puede ser firmante/);
  });
});

describe("telegram webhook", () => {
  test("calls setWebhook with the route URL and the secret, and checks getWebhookInfo", async () => {
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const fetchImpl = async (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) });
      const result = url.endsWith("/getWebhookInfo") ? { url: "https://coop.example/api/telegram", pending_update_count: 0 } : true;
      return { json: async () => ({ ok: true, result }) };
    };
    const r = await setTelegramWebhook({ token: "123:abc", secret: "s3cr3t_-x", appUrl: "https://coop.example/", fetchImpl });
    expect(r.url).toBe("https://coop.example/api/telegram");
    expect(sent[0]).toEqual({
      url: "https://api.telegram.org/bot123:abc/setWebhook",
      body: {
        url: "https://coop.example/api/telegram",
        secret_token: "s3cr3t_-x",
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
      },
    });
    expect(sent[1].url).toBe("https://api.telegram.org/bot123:abc/getWebhookInfo");
  });

  test("refuses plain http, a missing or malformed secret, and reports Telegram's errors", async () => {
    expect(() => webhookUrl("http://localhost:3000")).toThrow(/HTTPS/);
    const never = async () => {
      throw new Error("should not call");
    };
    await expect(setTelegramWebhook({ token: "1:a", secret: undefined, appUrl: "https://x.test", fetchImpl: never })).rejects.toThrow(
      /TELEGRAM_WEBHOOK_SECRET/,
    );
    await expect(setTelegramWebhook({ token: "1:a", secret: "con espacios", appUrl: "https://x.test", fetchImpl: never })).rejects.toThrow(
      /letras, números/,
    );
    const failing = async () => ({ json: async () => ({ ok: false, description: "Unauthorized" }) });
    await expect(setTelegramWebhook({ token: "1:a", secret: "ok", appUrl: "https://x.test", fetchImpl: failing })).rejects.toThrow(
      /Unauthorized/,
    );
  });
});

const hasAnvil = anvilAvailable();

describe.skipIf(!hasAnvil)("setup.ts against a clean local anvil", { timeout: 300_000 }, () => {
  let anvil: Anvil;
  beforeAll(async () => {
    // forge script writes its broadcast log there instead of contracts/broadcast.
    process.env.FOUNDRY_BROADCAST = mkdtempSync(path.join(os.tmpdir(), "forge-broadcast-"));
    anvil = await startAnvil();
  });
  afterAll(async () => {
    await anvil?.stop();
  });

  test("deploys, configures the contract with test keys, seeds the database and prints the env", async () => {
    const db = await createTestDb();
    const log: string[] = [];
    const r = await runSetup({
      configPath: DEMO,
      env: {
        CHAIN: "local",
        RPC_URL: anvil.url,
        DEPLOYER_PRIVATE_KEY: undefined,
        AGENT_PRIVATE_KEY: undefined,
        AGENT_ADDRESS: undefined,
        ATTRIBUTION_CODE: undefined,
        DATABASE_URL: undefined,
        SIGNER_PRIVATE_KEYS: undefined,
      },
      db,
      log: (s) => log.push(s),
    });
    if (r.status !== "done") throw new Error(r.status);
    expect(r.chainId).toBe(31337);
    expect(r.proposalsExecuted).toBe(7);

    const client = publicClient();
    const t = r.deployment.treasury;
    const lines = await client.readContract({ address: t, abi: treasuryPolicyAbi, functionName: "budgetLines" });
    expect(lines).toHaveLength(6);
    const comedor = await client.readContract({ address: t, abi: treasuryPolicyAbi, functionName: "budget", args: [keccak256(toHex("comedor"))] });
    expect(comedor.allocated).toBe(BigInt(400_000) * BigInt(10) ** BigInt(18));
    expect(await client.readContract({ address: t, abi: treasuryPolicyAbi, functionName: "perTxCap" })).toBe(BigInt(50_000) * BigInt(10) ** BigInt(18));

    const [coop] = await db.select().from(cooperadora);
    expect(coop).toMatchObject({ cuit: BigInt(30712345678), chainId: 31337, treasuryAddress: t, boxFactoryAddress: r.deployment.boxFactory });
    expect(await db.select().from(persons)).toHaveLength(7);
    const [vendor] = await db.select().from(vendors);
    const [vendorPerson] = await db.select().from(persons).where(eq(persons.phone, "+5493884000006"));
    expect(vendor).toMatchObject({ cuit: BigInt(20123456786), personId: vendorPerson.id, enabled: true });
    expect((await db.select().from(budgetLines)).map((l) => l.slug)).toContain("gastos-operativos");

    const out = log.join("\n");
    for (const k of ["FACTORY_ADDRESS", "WARS_ADDRESS", "DEPLOY_BLOCK", "TICK_SECRET"]) expect(out).toContain(`${k}=`);
    expect(out).not.toContain(AGENT_KEY.slice(2));

    // Every transaction setup sent carries the (dev) attribution tag, the deploy included.
    const latest = BigInt(await anvilRpc<string>(anvil.url, "eth_blockNumber"));
    let count = 0;
    for (let n = BigInt(1); n <= latest; n++) {
      const block = await anvilRpc<{ transactions: { input: Hex }[] }>(anvil.url, "eth_getBlockByNumber", [toHex(n), true]);
      for (const tx of block.transactions) {
        count++;
        expect(readAttribution(tx.input)).toEqual(["cooperadora_dev"]);
      }
    }
    expect(count).toBe(3 + 7 * 2);

    // A second run against the same database is refused before sending anything.
    const blockBefore = await anvilRpc<string>(anvil.url, "eth_blockNumber");
    await expect(
      runSetup({ configPath: DEMO, env: { CHAIN: "local", RPC_URL: anvil.url, ATTRIBUTION_CODE: undefined, DATABASE_URL: undefined }, db, log: quiet }),
    ).rejects.toThrow(/ya tiene una cooperadora/);
    expect(await anvilRpc<string>(anvil.url, "eth_blockNumber")).toBe(blockBefore);
  });
});

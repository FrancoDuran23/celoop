// One-shot instance setup: deploy, load the configuration into the contract, seed the database and
// print the environment for Vercel. See docs/specs/07-setup-e2e.md.
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { decodeEventLog, encodeFunctionData, isAddressEqual, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Db } from "@/db";
import { budgetLines, cooperadora, persons, vendors } from "@/db/schema";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { ANVIL_KEYS } from "@/lib/chain/anvil";
import { attributionSuffix } from "@/lib/chain/attribution";
import { publicClient } from "@/lib/chain/clients";
import { resetEnv } from "@/lib/env";
import { forgeDeploy, sendTagged, type Deployment } from "./chain";
import { buildPlan, loadConfig, parseConfig, type InstanceConfig, type Plan, type Proposal } from "./config";
import { openScriptDb } from "./db";
import { checkNode, chainName, LOCAL_RPC, safetyCut } from "./guard";

/** Mainnet USDT fee-currency adapter (see .env.example). */
const MAINNET_FEE_CURRENCY = "0x0E2A3e05bc9A16F5292A6170456A710cb89C6f72";

export type SetupOptions = {
  /** JSON file, or an already parsed config plus the directory paths in it are relative to. */
  configPath?: string;
  config?: InstanceConfig | unknown;
  baseDir?: string;
  yes?: boolean;
  /** Variables read instead of process.env (CHAIN, RPC_URL, keys, ATTRIBUTION_CODE, DATABASE_URL...). */
  env?: Record<string, string | undefined>;
  /** Keys that sign the configuration proposals on local. Defaults to anvil's dev keys. */
  signerKeys?: Hex[];
  /** Use this database instead of opening one (tests). */
  db?: Db;
  freshDb?: boolean;
  pgliteDir?: string;
  log?: (s: string) => void;
};

export type SetupResult =
  | { status: "refused" | "needs-confirmation"; plan: Plan; message: string }
  | {
      status: "done";
      plan: Plan;
      chainId: number;
      deployment: Deployment;
      deployBlock: bigint;
      /** Proposals executed on local; on a real network they are printed for the signers. */
      proposalsExecuted: number;
      env: Record<string, string>;
    };

const PROPOSAL_KIND_NAMES = ["SetBudget", "MoveBudget", "SetVendor", "SetCaps", "SetSigners", "SetAgent", "SetConfigHash", "Unpause"];

function settings(opts: SetupOptions) {
  const e = { ...process.env, ...(opts.env ?? {}) };
  const get = (k: string) => (e[k]?.trim() ? e[k]!.trim() : undefined);
  const chain = chainName(get("CHAIN"));
  const local = chain === "local";
  const deployerKey = (get("DEPLOYER_PRIVATE_KEY") ?? (local ? ANVIL_KEYS[0] : undefined)) as Hex | undefined;
  const agentKey = (get("AGENT_PRIVATE_KEY") ?? (local ? ANVIL_KEYS[1] : undefined)) as Hex | undefined;
  const agent = (get("AGENT_ADDRESS") ?? (agentKey ? privateKeyToAccount(agentKey).address : undefined)) as Address | undefined;
  return {
    chain,
    rpcUrl: get("RPC_URL") ?? (local ? LOCAL_RPC : undefined),
    deployerKey,
    agent,
    attributionCode: get("ATTRIBUTION_CODE"),
    databaseUrl: get("DATABASE_URL"),
    /** Only Sepolia may reuse an existing token; local always deploys MockWARS, mainnet uses wARS. */
    warsAddress: chain === "sepolia" ? get("WARS_ADDRESS") : undefined,
    signerKeys: opts.signerKeys ?? (get("SIGNER_PRIVATE_KEYS")?.split(",").map((k) => k.trim() as Hex) ?? [...ANVIL_KEYS]),
  };
}

const fmt = (n: bigint) => `$ ${(n / BigInt(10) ** BigInt(18)).toLocaleString("es-AR")}`;

function printPlan(log: (s: string) => void, plan: Plan, s: ReturnType<typeof settings>) {
  const c = plan.config;
  log(`\nCooperadora: ${c.cooperadora.name} (${c.cooperadora.school}), CUIT ${c.cooperadora.cuit}`);
  log(`Red: ${s.chain} · RPC ${s.rpcUrl ?? "(falta RPC_URL)"}`);
  log(`Acta: ${plan.actaFile}\n  configHash ${plan.configHash}`);
  log(`Agente: ${s.agent}`);
  log(`Firmantes (${plan.threshold} de ${plan.signers.length}): ${plan.signers.join(", ")}`);
  log(`Topes de pago automático: ${fmt(plan.perTxCap)} por pago, ${fmt(plan.vendorMonthlyCap)} por proveedor cada 30 días`);
  log(`Token: ${s.chain === "mainnet" ? "wARS real" : s.warsAddress ? s.warsAddress : "MockWARS (se despliega)"}`);
  log(`Propuestas de configuración (${plan.proposals.length}):`);
  for (const p of plan.proposals) log(`  - ${p.summary}`);
  log(`Base: ${c.people.length} personas, ${c.vendors.length} proveedores, ${plan.lines.length} partidas`);
  for (const w of plan.warnings) log(`Atención: ${w}`);
}

async function proposalIdFrom(receipt: { logs: { address: Address; data: Hex; topics: [Hex, ...Hex[]] | [] }[] }, treasury: Address) {
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, treasury)) continue;
    try {
      const ev = decodeEventLog({ abi: treasuryPolicyAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "ProposalCreated") return ev.args.proposalId;
    } catch {
      // another event
    }
  }
  throw new Error("la propuesta no emitió ProposalCreated");
}

/** Local: the first signers with a known key propose and approve each change until it executes. */
async function executeProposals(plan: Plan, treasury: Address, keys: Hex[], log: (s: string) => void): Promise<number> {
  for (const p of plan.proposals) {
    const [proposer, ...approvers] = keys;
    const receipt = await sendTagged(
      proposer,
      treasury,
      encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "propose", args: [p.kindIndex, p.data] }),
    );
    const id = await proposalIdFrom(receipt as never, treasury);
    for (const key of approvers.slice(0, plan.threshold - 1)) {
      await sendTagged(key, treasury, encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "approveProposal", args: [id] }));
    }
    const [, , , executed] = await publicClient().readContract({ address: treasury, abi: treasuryPolicyAbi, functionName: "proposal", args: [id] });
    if (!executed) throw new Error(`la propuesta ${id} (${p.summary}) no se ejecutó`);
    log(`  ✓ #${id} ${p.summary}`);
  }
  return plan.proposals.length;
}

function printProposalsForSigners(plan: Plan, treasury: Address, log: (s: string) => void) {
  log(`\nPropuestas para que las firmen los firmantes (${plan.threshold} de ${plan.signers.length}) desde /firmar.`);
  log(`Cada una es una llamada a ${treasury}.propose(kind, data); se ejecuta al juntar el umbral.`);
  plan.proposals.forEach((p: Proposal, i) => {
    log(`  ${i + 1}. ${p.summary}`);
    log(`     kind ${p.kindIndex} (${PROPOSAL_KIND_NAMES[p.kindIndex]}) · data ${p.data}`);
    log(`     calldata ${encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "propose", args: [p.kindIndex, p.data] })}`);
  });
}

/** Upserts the cooperadora, the padrón, vendors and budget lines. Refuses to mix two deployments. */
async function seed(db: Db, plan: Plan, chainId: number, d: Deployment) {
  const c = plan.config;
  const coop = {
    name: c.cooperadora.name,
    school: c.cooperadora.school,
    cuit: c.cooperadora.cuit,
    ruce: c.cooperadora.ruce ?? null,
    chainId,
    treasuryAddress: d.treasury,
    boxFactoryAddress: d.boxFactory,
    configHash: plan.configHash,
  };
  // createdAt stays "now": the tick skips closing months that ended before the cooperadora existed.
  await db.insert(cooperadora).values({ id: 1, ...coop }).onConflictDoUpdate({ target: cooperadora.id, set: coop });

  for (const p of c.people) {
    const row = { name: p.name, roles: p.roles, kind: p.kind ?? null, safeAddress: p.safeAddress ?? null };
    await db.insert(persons).values({ phone: p.phone, ...row }).onConflictDoUpdate({ target: persons.phone, set: row });
  }
  for (const v of c.vendors) {
    const [person] = v.phone ? await db.select({ id: persons.id }).from(persons).where(eq(persons.phone, v.phone)) : [];
    const row = { legalName: v.legalName, address: v.address, personId: person?.id ?? null, enabled: true };
    await db.insert(vendors).values({ cuit: v.cuit, ...row }).onConflictDoUpdate({ target: vendors.cuit, set: row });
  }
  for (const l of plan.lines) {
    await db
      .insert(budgetLines)
      .values({ lineId: l.lineId, slug: l.slug, name: l.name })
      .onConflictDoUpdate({ target: budgetLines.lineId, set: { slug: l.slug, name: l.name } });
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(persons);
  return n;
}

const secret = () => randomBytes(24).toString("base64url");

export async function runSetup(opts: SetupOptions): Promise<SetupResult> {
  const log = opts.log ?? console.log;
  const s = settings(opts);
  if (!s.agent) throw new Error("Falta AGENT_PRIVATE_KEY (o AGENT_ADDRESS) para saber la dirección del agente.");

  let config: InstanceConfig;
  let baseDir: string;
  if (opts.configPath) ({ config, baseDir } = loadConfig(opts.configPath));
  else if (opts.config) [config, baseDir] = [parseConfig(opts.config), opts.baseDir ?? process.cwd()];
  else throw new Error("Falta el archivo de configuración.");

  const plan = buildPlan(config, baseDir, s.agent);
  printPlan(log, plan, s);

  // ── Safety cut: nothing below this line runs off local without --yes. ──
  const decision = safetyCut({ chain: s.chain, yes: opts.yes ?? false, attributionCode: s.attributionCode });
  if (decision.action !== "proceed") {
    log(`\n${decision.message}`);
    return { status: decision.action === "refuse" ? "refused" : "needs-confirmation", plan, message: decision.message };
  }
  if (!s.rpcUrl) throw new Error(`Falta RPC_URL para CHAIN=${s.chain}.`);
  if (!s.deployerKey) throw new Error("Falta DEPLOYER_PRIVATE_KEY.");

  // Module 03 helpers (tag, chain, clients) read these.
  resetEnv({ CHAIN: s.chain, RPC_URL: s.rpcUrl, ATTRIBUTION_CODE: s.attributionCode ?? "" });
  const chainId = await checkNode(s.chain, s.rpcUrl);

  let localKeys: Hex[] = [];
  if (s.chain === "local") {
    const byAddress = new Map(s.signerKeys.map((k) => [privateKeyToAccount(k).address.toLowerCase(), k]));
    localKeys = plan.signers.flatMap((a) => byAddress.get(a.toLowerCase()) ?? []);
    if (localKeys.length < plan.threshold) {
      throw new Error(
        `En local, setup firma las propuestas con claves de prueba, y solo conoce ${localKeys.length} de los firmantes (hacen falta ${plan.threshold}). Usá direcciones de anvil o pasá SIGNER_PRIVATE_KEYS.`,
      );
    }
  }

  // One instance per database: refuse before sending anything if this one is already in use.
  const handle = await openScriptDb({ db: opts.db, databaseUrl: s.databaseUrl, pgliteDir: opts.pgliteDir, fresh: opts.freshDb, log });
  let deployment: Deployment;
  let deployBlock: bigint;
  let proposalsExecuted = 0;
  try {
    const [existing] = await handle.db.select().from(cooperadora);
    if (existing) {
      throw new Error(
        `La base ya tiene una cooperadora (tesoro ${existing.treasuryAddress}). Usá una base nueva: --fresh-db en local, otra branch de Neon en una red real.`,
      );
    }

    const before = await publicClient().getBlockNumber({ cacheTime: 0 });
    log(`\nDesplegando con forge script contracts/script/Deploy.s.sol…`);
    deployment = await forgeDeploy({
      rpcUrl: s.rpcUrl,
      log,
      env: {
        CHAIN: s.chain,
        SIGNERS: plan.signers.join(","),
        AGENT: s.agent,
        THRESHOLD: String(plan.threshold),
        PER_TX_CAP: plan.perTxCap.toString(),
        VENDOR_MONTHLY_CAP: plan.vendorMonthlyCap.toString(),
        CONFIG_HASH: plan.configHash,
        ATTRIBUTION_SUFFIX: attributionSuffix(),
        DEPLOYER_PRIVATE_KEY: s.deployerKey,
        WARS_ADDRESS: s.warsAddress,
      },
    });
    if (deployment.chainId !== chainId) throw new Error(`forge desplegó en el chain ${deployment.chainId}, se esperaba ${chainId}`);
    deployBlock = before + BigInt(1);

    if (s.chain === "local") {
      log(`\nCargando la configuración en el contrato (firmando con claves de prueba)…`);
      proposalsExecuted = await executeProposals(plan, deployment.treasury, localKeys, log);
    } else {
      printProposalsForSigners(plan, deployment.treasury, log);
    }

    const people = await seed(handle.db, plan, chainId, deployment);
    log(`Base sembrada (${handle.kind}): ${people} personas, ${plan.config.vendors.length} proveedores, ${plan.lines.length} partidas.`);
  } finally {
    await handle.close();
  }

  const out: Record<string, string> = {
    CHAIN: s.chain,
    RPC_URL: s.rpcUrl,
    TREASURY_ADDRESS: deployment.treasury,
    BOX_FACTORY_ADDRESS: deployment.boxFactory,
    WARS_ADDRESS: deployment.token,
    DEPLOY_BLOCK: deployBlock.toString(),
    AGENT_SEND: s.chain === "local" ? "on" : "off",
  };
  if (s.attributionCode) out.ATTRIBUTION_CODE = s.attributionCode;
  if (s.chain === "mainnet") out.FEE_CURRENCY = MAINNET_FEE_CURRENCY;
  const e = { ...process.env, ...(opts.env ?? {}) };
  for (const k of ["TICK_SECRET", "TELEGRAM_WEBHOOK_SECRET", "SESSION_SECRET"]) out[k] = e[k]?.trim() || secret();

  log(`\nVariables de entorno (pegalas en Vercel; AGENT_PRIVATE_KEY, DATABASE_URL, TELEGRAM_BOT_TOKEN y las claves de API van aparte):`);
  for (const [k, v] of Object.entries(out)) log(`${k}=${v}`);
  if (s.chain !== "local") {
    log(`\nAGENT_SEND quedó en off: pasalo a on cuando las propuestas estén ejecutadas y el agente tenga saldo para las comisiones.`);
  }
  log(`Nota: el primer tick de cada mes cierra el mes anterior. Los meses anteriores al alta de la cooperadora no se cierran.`);
  return { status: "done", plan, chainId, deployment, deployBlock, proposalsExecuted, env: out };
}

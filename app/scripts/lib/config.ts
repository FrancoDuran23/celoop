// Instance configuration (scripts/config/<name>.json): the cooperadora, its padrón, vendors,
// budget lines, caps and threshold. Parsed and turned into what the contract and the database take.
import { readFileSync } from "node:fs";
import path from "node:path";
import { encodeAbiParameters, getAddress, isAddress, keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import { z } from "zod";
import { COMMISSION_ROLES, OPERATOR_ROLE, REVIEWER_ROLE, SIGNER_ROLES, VENDOR_ROLE } from "@/lib/orchestrator/people";
import { proposalKindIndex, type ProposalKindName } from "@/lib/wallet/proposals";

export const ROLES = ["socio", ...COMMISSION_ROLES, REVIEWER_ROLE, "asesor", VENDOR_ROLE, OPERATOR_ROLE] as const;

const address = z
  .string()
  .refine((s) => isAddress(s, { strict: false }), "dirección inválida")
  .transform((s) => getAddress(s));
const cuit = z
  .union([z.string(), z.number(), z.bigint()])
  .transform((v) => String(v).replace(/[-\s]/g, ""))
  .refine((s) => /^\d{11}$/.test(s), "el CUIT tiene que tener 11 dígitos")
  .transform((s) => BigInt(s));
/** Pesos as a decimal ("12500", "12500.50" or a number). */
const pesos = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((s) => /^\d+(\.\d{1,2})?$/.test(s), "monto en pesos inválido (usá 12500 o 12500.50)");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha en formato AAAA-MM-DD");

const schema = z.object({
  cooperadora: z.object({
    name: z.string().min(1),
    school: z.string().min(1),
    cuit,
    ruce: z.string().optional(),
    /** Path to the acta PDF, relative to the JSON file. Its keccak256 goes on chain as configHash. */
    actaPath: z.string().min(1),
  }),
  people: z
    .array(
      z.object({
        name: z.string().min(1),
        phone: z.string().regex(/^\+\d{8,15}$/, "teléfono en formato E.164, por ejemplo +5493884000000"),
        roles: z.array(z.enum(ROLES)),
        kind: z.enum(["padre", "docente", "exalumno", "otro"]).optional(),
        /** Signers: the address that signs on the contract (their passkey Safe on a real network). */
        safeAddress: address.optional(),
      }),
    )
    .min(1),
  vendors: z.array(
    z.object({
      legalName: z.string().min(1),
      cuit,
      address,
      /** Phone of the vendor's person in `people`, if they use the bot. */
      phone: z.string().optional(),
    }),
  ),
  budgetLines: z
    .array(
      z.object({
        slug: z.string().regex(/^[a-z0-9-]+$/, "slug en minúsculas, números y guiones"),
        name: z.string().min(1),
        amount: pesos,
        /** Last day of the budget period (Argentine time). Informative only on chain. */
        periodEnd: isoDate,
      }),
    )
    .min(1),
  caps: z.object({ perTxCap: pesos, vendorMonthlyCap: pesos }),
  threshold: z.number().int().positive(),
});

export type InstanceConfig = z.infer<typeof schema>;

export type Proposal = { kind: ProposalKindName; kindIndex: number; data: Hex; summary: string };

export type Plan = {
  config: InstanceConfig;
  configHash: Hex;
  actaFile: string;
  signers: Address[];
  threshold: number;
  perTxCap: bigint;
  vendorMonthlyCap: bigint;
  lines: { lineId: Hex; slug: string; name: string; allocated: bigint; periodEnd: bigint }[];
  proposals: Proposal[];
  warnings: string[];
};

export const toBase = (p: string) => parseUnits(p, 18);
export const lineIdOf = (slug: string): Hex => keccak256(toHex(slug));

/** Unix seconds of the last second of `date` in Argentina (UTC-3). */
export function endOfArDay(date: string): bigint {
  const [y, m, d] = date.split("-").map(Number);
  return BigInt(Date.UTC(y, m - 1, d + 1, 3) / 1000 - 1);
}

export function parseConfig(raw: unknown): InstanceConfig {
  const res = schema.safeParse(raw);
  if (!res.success) {
    const issues = res.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`La configuración no es válida:\n${issues}`);
  }
  return res.data;
}

export function loadConfig(file: string): { config: InstanceConfig; baseDir: string } {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return { config: parseConfig(raw), baseDir: path.dirname(path.resolve(file)) };
}

const PESO = (n: bigint) => `$ ${(n / BigInt(10) ** BigInt(18)).toLocaleString("es-AR")}`;

/**
 * Checks the config against the agent (and auditor, if any) addresses and derives everything setup
 * sends and stores. The auditor must be a third party: not the agent, not a signer, not a vendor.
 */
export function buildPlan(config: InstanceConfig, baseDir: string, agent: Address, auditor?: Address): Plan {
  const warnings: string[] = [];
  const errors: string[] = [];

  const actaFile = path.resolve(baseDir, config.cooperadora.actaPath);
  const configHash = keccak256(readFileSync(actaFile));

  const phones = new Set<string>();
  for (const p of config.people) {
    if (phones.has(p.phone)) errors.push(`teléfono repetido en el padrón: ${p.phone}`);
    phones.add(p.phone);
  }

  const signerPeople = config.people.filter((p) => p.roles.some((r) => (SIGNER_ROLES as readonly string[]).includes(r)));
  const signers: Address[] = [];
  for (const p of signerPeople) {
    if (!p.safeAddress) {
      warnings.push(`${p.name} tiene rol de firmante pero no tiene safeAddress: no queda como firmante en el contrato`);
      continue;
    }
    if (signers.some((s) => s.toLowerCase() === p.safeAddress!.toLowerCase())) {
      errors.push(`safeAddress repetida: ${p.safeAddress}`);
      continue;
    }
    signers.push(p.safeAddress);
  }
  if (signers.length === 0) errors.push("no hay ningún firmante con safeAddress");
  if (config.threshold > signers.length) {
    errors.push(`el umbral (${config.threshold}) es mayor que la cantidad de firmantes (${signers.length})`);
  }
  if (signers.some((s) => s.toLowerCase() === agent.toLowerCase())) errors.push("el agente no puede ser firmante");
  if (auditor) {
    if (auditor.toLowerCase() === agent.toLowerCase()) errors.push("el auditor no puede ser el agente: tiene que tener su propia clave");
    if (signers.some((s) => s.toLowerCase() === auditor.toLowerCase())) errors.push("el auditor no puede ser firmante");
  } else {
    warnings.push("no hay auditor: los pagos chicos salen sin una segunda revisión");
  }
  if (!config.people.some((p) => p.roles.includes(REVIEWER_ROLE))) warnings.push("no hay ninguna persona con rol revisor");
  if (!config.people.some((p) => p.roles.includes(OPERATOR_ROLE))) {
    warnings.push("no hay ninguna persona con rol operador: nadie recibe las alertas técnicas");
  }

  const vendorCuits = new Set<bigint>();
  for (const v of config.vendors) {
    if (vendorCuits.has(v.cuit)) errors.push(`CUIT de proveedor repetido: ${v.cuit}`);
    vendorCuits.add(v.cuit);
    if (v.cuit === config.cooperadora.cuit) errors.push(`el proveedor ${v.legalName} tiene el CUIT de la cooperadora`);
    if (v.address.toLowerCase() === agent.toLowerCase()) errors.push(`el proveedor ${v.legalName} tiene la dirección del agente`);
    if (auditor && v.address.toLowerCase() === auditor.toLowerCase()) errors.push(`el proveedor ${v.legalName} tiene la dirección del auditor`);
    if (v.phone && !phones.has(v.phone)) errors.push(`el proveedor ${v.legalName} apunta a un teléfono que no está en el padrón`);
  }

  const slugs = new Set<string>();
  const lines = config.budgetLines.map((l) => {
    if (slugs.has(l.slug)) errors.push(`partida repetida: ${l.slug}`);
    slugs.add(l.slug);
    return { lineId: lineIdOf(l.slug), slug: l.slug, name: l.name, allocated: toBase(l.amount), periodEnd: endOfArDay(l.periodEnd) };
  });

  if (errors.length > 0) throw new Error(`La configuración no es válida:\n${errors.map((e) => `  - ${e}`).join("\n")}`);

  const proposals: Proposal[] = [
    ...lines.map((l) => ({
      kind: "SetBudget" as const,
      kindIndex: proposalKindIndex("SetBudget"),
      data: encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }],
        [l.lineId, l.allocated, l.periodEnd],
      ),
      summary: `Partida ${l.name} (${l.slug}): ${PESO(l.allocated)} hasta el ${config.budgetLines.find((b) => b.slug === l.slug)!.periodEnd}`,
    })),
    ...config.vendors.map((v) => ({
      kind: "SetVendor" as const,
      kindIndex: proposalKindIndex("SetVendor"),
      data: encodeAbiParameters([{ type: "address" }, { type: "uint64" }, { type: "bool" }], [v.address, v.cuit, true]),
      summary: `Habilitar proveedor ${v.legalName} (CUIT ${v.cuit}) en ${v.address}`,
    })),
  ];

  return {
    config,
    configHash,
    actaFile,
    signers,
    threshold: config.threshold,
    perTxCap: toBase(config.caps.perTxCap),
    vendorMonthlyCap: toBase(config.caps.vendorMonthlyCap),
    lines,
    proposals,
    warnings,
  };
}

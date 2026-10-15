// Executed configuration proposals, described in plain Spanish, with signers shown by role.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { approvals, budgetLines, chainEvents, persons, proposals, vendors } from "@/db/schema";
import { formatCuit, formatPesos } from "./format";
import type { BudgetChangeRow } from "./types";

const KIND_NAMES = ["setbudget", "movebudget", "setvendor", "setcaps", "setsigners", "setagent", "setconfighash", "unpause"];
const ROLE_ORDER = ["presidente", "tesorero", "secretario", "revisor"];

export function normalizeKind(kind: string): string {
  const k = kind.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/^\d+$/.test(k)) return KIND_NAMES[Number(k)] ?? k;
  return k;
}

function pick(d: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = d[key];
    if (v !== undefined && v !== null && v !== "") return String(v);
  }
  return null;
}

export interface Lookups {
  lineName: (lineId: string | null) => string;
  roleOf: (address: string) => string;
  vendorName: (address: string | null) => string;
  threshold: number;
  signerCount: number;
}

export async function loadLookups(db: Db): Promise<Lookups> {
  const lines = await db.select().from(budgetLines);
  const people = await db.select().from(persons);
  const vendorRows = await db.select().from(vendors);
  const signersEvents = await db.select().from(chainEvents).where(eq(chainEvents.eventName, "SignersSet"));
  signersEvents.sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
  const last = signersEvents.at(-1)?.args as { signers?: unknown[]; threshold?: unknown } | undefined;

  const names = new Map(lines.map((l) => [l.lineId.toLowerCase(), l.name]));
  const roles = new Map<string, string>();
  for (const p of people) {
    if (!p.safeAddress) continue;
    const role = ROLE_ORDER.find((r) => p.roles.includes(r));
    roles.set(p.safeAddress.toLowerCase(), role ? role[0].toUpperCase() + role.slice(1) : "Firmante");
  }
  const vendorByAddr = new Map(vendorRows.map((v) => [v.address.toLowerCase(), v.legalName]));

  return {
    lineName: (id) => (id ? (names.get(id.toLowerCase()) ?? "otra partida") : "otra partida"),
    roleOf: (a) => roles.get(a.toLowerCase()) ?? "Firmante",
    vendorName: (a) => (a ? (vendorByAddr.get(a.toLowerCase()) ?? "un proveedor") : "un proveedor"),
    threshold: Number(last?.threshold ?? 2) || 2,
    signerCount: Array.isArray(last?.signers) ? last.signers.length : 3,
  };
}

export function describeProposal(kind: string, decoded: unknown, l: Lookups): string {
  const d = (decoded && typeof decoded === "object" ? decoded : {}) as Record<string, unknown>;
  switch (normalizeKind(kind)) {
    case "movebudget":
      return `Se movieron ${formatPesos(pick(d, "amount") ?? "0")} de la partida ${l.lineName(pick(d, "fromLine", "from"))} a la partida ${l.lineName(pick(d, "toLine", "to"))}.`;
    case "setbudget":
      return `Se fijó la partida ${l.lineName(pick(d, "lineId", "line"))} en ${formatPesos(pick(d, "allocated", "amount") ?? "0")}.`;
    case "setvendor": {
      const cuit = pick(d, "cuit");
      const who = cuit ? `el proveedor con CUIT ${formatCuit(cuit)}` : `el proveedor ${l.vendorName(pick(d, "vendor"))}`;
      return `Se ${pick(d, "enabled") === "false" ? "deshabilitó" : "habilitó"} a ${who}.`;
    }
    case "setcaps":
      return `Se cambiaron los topes: ${formatPesos(pick(d, "perTxCap") ?? "0")} por pago y ${formatPesos(pick(d, "vendorMonthlyCap") ?? "0")} por proveedor al mes.`;
    case "setsigners":
      return `Se cambió el grupo de firmantes${pick(d, "threshold") ? ` (se necesitan ${pick(d, "threshold")} firmas)` : ""}.`;
    case "setagent":
      return "Se cambió el agente que prepara los pagos.";
    case "setconfighash":
      return "Se actualizó la configuración de la cooperadora.";
    case "unpause":
      return "Se reactivaron los pagos.";
    default:
      return "Cambio de configuración.";
  }
}

/** Executed proposals with their execution time, optionally limited to [from, to). */
export async function executedChanges(db: Db, range?: { start: Date; end: Date }): Promise<BudgetChangeRow[]> {
  const l = await loadLookups(db);
  const rows = await db.select().from(proposals).where(eq(proposals.status, "executed"));
  const executedEvents = await db.select().from(chainEvents).where(eq(chainEvents.eventName, "ProposalExecuted"));
  const timeById = new Map<string, Date>();
  for (const e of executedEvents) {
    const id = (e.args as { proposalId?: unknown }).proposalId;
    if (id !== undefined) timeById.set(String(id), e.blockTime);
  }
  const out: Array<BudgetChangeRow & { id: bigint }> = [];
  for (const p of rows) {
    const when = timeById.get(p.proposalId.toString()) ?? p.updatedAt;
    if (range && (when < range.start || when >= range.end)) continue;
    const signed = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.target, "proposal"), eq(approvals.targetId, p.proposalId)));
    const signers = [...new Set(signed.map((a) => l.roleOf(a.signer)))].sort();
    out.push({
      id: p.proposalId,
      date: when.toISOString(),
      kind: normalizeKind(p.kind),
      description: describeProposal(p.kind, p.decoded, l),
      reason: p.reasonText,
      signers,
      txHash: p.executedTxHash,
    });
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || Number(a.id - b.id));
  return out.map(({ id: _id, ...rest }) => rest);
}

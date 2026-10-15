// Executed configuration proposals, described in plain English, with signers shown by role.
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { approvals, budgetLines, chainEvents, persons, proposals, vendors } from "@/db/schema";
import { formatCuit, formatPesos } from "./format";
import type { BudgetChangeRow } from "./types";

const KIND_NAMES = ["setbudget", "movebudget", "setvendor", "setcaps", "setsigners", "setagent", "setconfighash", "unpause"];
const ROLE_ORDER = ["presidente", "tesorero", "secretario", "revisor"];
const ROLE_LABEL: Record<string, string> = { presidente: "President", tesorero: "Treasurer", secretario: "Secretary", revisor: "Auditor" };

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
    roles.set(p.safeAddress.toLowerCase(), role ? ROLE_LABEL[role] : "Signer");
  }
  const vendorByAddr = new Map(vendorRows.map((v) => [v.address.toLowerCase(), v.legalName]));

  return {
    lineName: (id) => (id ? (names.get(id.toLowerCase()) ?? "another line") : "another line"),
    roleOf: (a) => roles.get(a.toLowerCase()) ?? "Signer",
    vendorName: (a) => (a ? (vendorByAddr.get(a.toLowerCase()) ?? "a vendor") : "a vendor"),
    threshold: Number(last?.threshold ?? 2) || 2,
    signerCount: Array.isArray(last?.signers) ? last.signers.length : 3,
  };
}

export function describeProposal(kind: string, decoded: unknown, l: Lookups): string {
  const d = (decoded && typeof decoded === "object" ? decoded : {}) as Record<string, unknown>;
  switch (normalizeKind(kind)) {
    case "movebudget":
      return `Moved ${formatPesos(pick(d, "amount") ?? "0")} from the ${l.lineName(pick(d, "fromLine", "from"))} line to the ${l.lineName(pick(d, "toLine", "to"))} line.`;
    case "setbudget":
      return `Set the ${l.lineName(pick(d, "lineId", "line"))} line to ${formatPesos(pick(d, "allocated", "amount") ?? "0")}.`;
    case "setvendor": {
      const cuit = pick(d, "cuit");
      const who = cuit ? `the vendor with tax ID ${formatCuit(cuit)}` : `the vendor ${l.vendorName(pick(d, "vendor"))}`;
      return `${pick(d, "enabled") === "false" ? "Disabled" : "Enabled"} ${who}.`;
    }
    case "setcaps":
      return `Changed the caps: ${formatPesos(pick(d, "perTxCap") ?? "0")} per payment and ${formatPesos(pick(d, "vendorMonthlyCap") ?? "0")} per vendor per month.`;
    case "setsigners":
      return `Changed the group of signers${pick(d, "threshold") ? ` (${pick(d, "threshold")} signatures required)` : ""}.`;
    case "setagent":
      return "Changed the agent that prepares payments.";
    case "setconfighash":
      return "Updated the co-op's published configuration.";
    case "unpause":
      return "Resumed payments.";
    default:
      return "Configuration change.";
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

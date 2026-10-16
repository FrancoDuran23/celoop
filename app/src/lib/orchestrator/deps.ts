// Everything the agent talks to, behind small ports so tests can swap them:
// the chain (module 03), the invoice reader (module 02), the reports API (module 05),
// file storage, the indexer, Telegram (via a Notifier) and the clock.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Address, Hex } from "viem";
import type { Db } from "@/db";
import type { Buttons, Notifier } from "@/lib/bot/notify";
import type { InvoiceKey, ProposePaymentResult, SweepBoxResult } from "@/lib/chain/agent";
import type { AuditStatus, PaymentStatus } from "@/lib/chain/treasury";
import { env } from "@/lib/env";
import type { InvoiceFile, ReadResult } from "@/lib/invoice";
import type { CoopRow } from "@/lib/tenant";
import { chatIdOf, claimNotice, releaseNotice } from "./chat-state";

export interface ChainPort {
  proposePayment(
    args: { key: string; vendor: Address; invoice: InvoiceKey; amount: bigint; lineId: Hex; fileHash: Hex },
    db: Db,
  ): Promise<ProposePaymentResult>;
  sweepBox(args: { key: string; ref: Hex }, db: Db): Promise<SweepBoxResult>;
  isInvoicePaid(invoiceId: Hex): Promise<boolean>;
  /** CREATE2 address of the deposit box for `ref`. */
  boxAddress(ref: Hex): Promise<Address>;
  /** wARS balance of an address. */
  balanceOf(address: Address): Promise<bigint>;
  /** Treasury balance, or null when the chain can't be read (callers fall back to the database). */
  treasuryBalance(): Promise<bigint | null>;
  /** A payment's status and the auditor's verdict, straight from the contract. */
  paymentState(paymentId: bigint): Promise<{ status: PaymentStatus; audit: AuditStatus }>;
}

export type CloseResult = { status: string; created: boolean };
export type PublishResult = { ok: true; pdfUrl: string | null } | { ok: false; error: string };

/** Module 05's internal endpoints, called with TICK_SECRET. */
export interface ReportsPort {
  close(period: string, cooperadoraId?: number): Promise<CloseResult>;
  publish(period: string, cooperadoraId?: number): Promise<PublishResult>;
}

/** Stores a file and returns its URL. */
export type FileStore = (name: string, bytes: Uint8Array, contentType: string) => Promise<string>;

export interface AgentDeps {
  db: Db;
  notify: Notifier;
  chain: ChainPort;
  readInvoice: (file: InvoiceFile) => Promise<ReadResult>;
  storeFile: FileStore;
  reports: ReportsPort;
  /** Copies new chain events into Postgres (runIndexer). The tick passes the cooperative id. */
  indexer: (cooperadoraId?: number) => Promise<unknown>;
  /** Production tick swaps in a chain port aimed at one treasury. Tests leave this unset. */
  chainFor?: (scope: { treasury: Address; boxFactory: Address }) => ChainPort;
  /**
   * Asks the auditor to review pending payments now, so a small one doesn't wait for the next cron
   * round. The auditor runs with its own deps and key; without this the cron still gets to it.
   */
  auditNow?: () => Promise<unknown>;
  now: () => Date;
  appUrl: string;
  /** Set by the tick and the bot while they work on one cooperative. */
  cooperadoraId?: number;
  /** Milliseconds a tick may spend before leaving the rest for the next minute. Default 240s. */
  tickBudgetMs?: number;
}

/**
 * The same deps, working on one cooperative: its id for every query and, in production, a chain
 * port aimed at its own treasury and box factory. The tick and the bot both go through here.
 */
export function forCooperadora<T extends AgentDeps>(deps: T, coop: Pick<CoopRow, "id" | "treasuryAddress" | "boxFactoryAddress">): T {
  const chain =
    deps.chainFor && coop.treasuryAddress && coop.boxFactoryAddress
      ? deps.chainFor({ treasury: coop.treasuryAddress as Address, boxFactory: coop.boxFactoryAddress as Address })
      : deps.chain;
  return { ...deps, cooperadoraId: coop.id, chain };
}

/** Module 03 behind the port. Imported lazily so tests that fake the chain never load viem clients. */
export function chainPort(scope: { db?: Db; treasury?: Address; boxFactory?: Address } = {}): ChainPort {
  const at = (db?: Db) => ({ db: db ?? scope.db, treasury: scope.treasury, boxFactory: scope.boxFactory });
  return {
    async proposePayment(args, db) {
      const { proposePayment } = await import("@/lib/chain/agent");
      return proposePayment(args, { ...at(db) });
    },
    async sweepBox(args, db) {
      const { sweepBox } = await import("@/lib/chain/agent");
      return sweepBox(args, { ...at(db) });
    },
    async isInvoicePaid(invoiceId) {
      const { isInvoicePaid } = await import("@/lib/chain/treasury");
      return isInvoicePaid(invoiceId, at());
    },
    async boxAddress(ref) {
      const { boxAddress } = await import("@/lib/chain/treasury");
      return boxAddress(ref, at());
    },
    async balanceOf(address) {
      const { warsBalanceOf } = await import("@/lib/chain/treasury");
      return warsBalanceOf(address, at());
    },
    async treasuryBalance() {
      try {
        const { getTreasuryState } = await import("@/lib/chain/treasury");
        return (await getTreasuryState(at())).balance;
      } catch {
        return null;
      }
    },
    async paymentState(paymentId) {
      const { getPayment, getPaymentAudit } = await import("@/lib/chain/treasury");
      const [p, a] = await Promise.all([getPayment(paymentId, at()), getPaymentAudit(paymentId, at())]);
      return { status: p.status, audit: a.status };
    },
  };
}

/** POST /api/reports/close and /api/reports/<period>/publish on APP_URL, with TICK_SECRET. */
export function httpReports(appUrl = env().APP_URL, secret = env().TICK_SECRET): ReportsPort {
  const call = async (pathname: string, body: unknown) => {
    if (!secret) throw new Error("Missing environment variable TICK_SECRET");
    const res = await fetch(`${appUrl.replace(/\/+$/, "")}${pathname}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, json };
  };
  return {
    async close(period, cooperadoraId) {
      const { res, json } = await call("/api/reports/close", { period, cooperadoraId });
      if (!res.ok) throw new Error(`reports/close ${period}: HTTP ${res.status} ${JSON.stringify(json)}`);
      return { status: String(json.status), created: json.created === true };
    },
    async publish(period, cooperadoraId) {
      const { res, json } = await call(`/api/reports/${period}/publish`, { cooperadoraId });
      if (res.ok) return { ok: true, pdfUrl: typeof json.pdfUrl === "string" ? json.pdfUrl : null };
      return { ok: false, error: typeof json.error === "string" ? json.error : `HTTP ${res.status}` };
    },
  };
}

/** Vercel Blob when BLOB_READ_WRITE_TOKEN is set, otherwise local disk (dev). */
export const storeFile: FileStore = async (name, bytes, contentType) => {
  if (env().BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(name, Buffer.from(bytes), {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return blob.url;
  }
  const file = path.join(process.cwd(), ".data", name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return `file:${file}`;
};

export function defaultAgentDeps(args: { db: Db; notify: Notifier } & Partial<AgentDeps>): AgentDeps {
  const { db } = args;
  return {
    chain: chainPort({ db }),
    readInvoice: async (file) => (await import("@/lib/invoice")).readInvoice(file),
    storeFile,
    reports: httpReports(),
    indexer: async (cooperadoraId?: number) => {
      const result = await (await import("@/lib/indexer")).runIndexer(db, { cooperadoraId });
      const [{ syncExecutedVendors }, { linkScope }] = await Promise.all([
        import("@/lib/wallet/vendor-sync"),
        import("@/lib/wallet/server"),
      ]);
      const scope = await linkScope(db, { cooperadoraId: cooperadoraId ?? null });
      const vendors = await syncExecutedVendors(db, scope.chain, { cooperadoraId: scope.cooperadoraId });
      return { ...result, vendorsApplied: vendors.applied };
    },
    now: () => new Date(),
    appUrl: env().APP_URL,
    ...args,
  };
}

/**
 * Sends a message to a person only once per `key` (kept in their chat state).
 * Returns false when it was already sent or the person has no chat.
 */
export async function notifyOnce(
  deps: Pick<AgentDeps, "db" | "notify">,
  personId: number,
  key: string,
  text: string | (() => Promise<{ text: string; buttons?: Buttons }>),
): Promise<boolean> {
  const chatId = await chatIdOf(deps.db, personId);
  if (chatId === null) return false;
  if (!(await claimNotice(deps.db, chatId, key))) return false;
  try {
    const msg = typeof text === "string" ? { text } : await text();
    await deps.notify(personId, msg.text, msg.buttons);
    return true;
  } catch (e) {
    await releaseNotice(deps.db, chatId, key);
    throw e;
  }
}

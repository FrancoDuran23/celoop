// Everything the agent talks to, behind small ports so tests can swap them:
// the chain (module 03), the invoice reader (module 02), the reports API (module 05),
// file storage, the indexer, Telegram (via a Notifier) and the clock.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Address, Hex } from "viem";
import type { Db } from "@/db";
import type { Buttons, Notifier } from "@/lib/bot/notify";
import type { InvoiceKey, ProposePaymentResult, SweepBoxResult } from "@/lib/chain/agent";
import { env } from "@/lib/env";
import type { InvoiceFile, ReadResult } from "@/lib/invoice";
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
}

export type CloseResult = { status: string; created: boolean };
export type PublishResult = { ok: true; pdfUrl: string | null } | { ok: false; error: string };

/** Module 05's internal endpoints, called with TICK_SECRET. */
export interface ReportsPort {
  close(period: string): Promise<CloseResult>;
  publish(period: string): Promise<PublishResult>;
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
  /** Copies new chain events into Postgres (runIndexer). */
  indexer: () => Promise<unknown>;
  now: () => Date;
  appUrl: string;
}

/** Module 03 behind the port. Imported lazily so tests that fake the chain never load viem clients. */
export function chainPort(): ChainPort {
  return {
    async proposePayment(args, db) {
      const { proposePayment } = await import("@/lib/chain/agent");
      return proposePayment(args, { db });
    },
    async sweepBox(args, db) {
      const { sweepBox } = await import("@/lib/chain/agent");
      return sweepBox(args, { db });
    },
    async isInvoicePaid(invoiceId) {
      const { isInvoicePaid } = await import("@/lib/chain/treasury");
      return isInvoicePaid(invoiceId);
    },
    async boxAddress(ref) {
      const { boxAddress } = await import("@/lib/chain/treasury");
      return boxAddress(ref);
    },
    async balanceOf(address) {
      const { warsBalanceOf } = await import("@/lib/chain/treasury");
      return warsBalanceOf(address);
    },
    async treasuryBalance() {
      try {
        const { getTreasuryState } = await import("@/lib/chain/treasury");
        return (await getTreasuryState()).balance;
      } catch {
        return null;
      }
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
    async close(period) {
      const { res, json } = await call("/api/reports/close", { period });
      if (!res.ok) throw new Error(`reports/close ${period}: HTTP ${res.status} ${JSON.stringify(json)}`);
      return { status: String(json.status), created: json.created === true };
    },
    async publish(period) {
      const { res, json } = await call(`/api/reports/${period}/publish`, {});
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
    chain: chainPort(),
    readInvoice: async (file) => (await import("@/lib/invoice")).readInvoice(file),
    storeFile,
    reports: httpReports(),
    indexer: async () => {
      const result = await (await import("@/lib/indexer")).runIndexer(db);
      const [{ syncExecutedVendors }, { chainReader }] = await Promise.all([
        import("@/lib/wallet/vendor-sync"),
        import("@/lib/wallet/server"),
      ]);
      const vendors = await syncExecutedVendors(db, chainReader);
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

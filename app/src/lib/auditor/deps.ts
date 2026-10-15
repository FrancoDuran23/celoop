// What the auditor talks to, behind small ports so tests can swap them. It has its own key
// (AUDITOR_PRIVATE_KEY) and reads the chain and the stored invoice files by itself; it never uses
// the treasurer's key, its invoice reader's LLM, or its decisions.
import { readFile } from "node:fs/promises";
import type { Address, Hex } from "viem";
import type { Db } from "@/db";
import type { Notifier } from "@/lib/bot/notify";
import type { AuditPaymentResult } from "@/lib/chain/auditor";
import type { AuditStatus, OnchainPayment } from "@/lib/chain/treasury";
import { env } from "@/lib/env";
import type { InvoiceFields, InvoiceFile } from "@/lib/invoice";

export interface AuditorChain {
  /** Our own address (from AUDITOR_PRIVATE_KEY). */
  self(): Promise<Address>;
  /** The auditor the contract trusts; zeroAddress when there is none. */
  treasuryAuditor(): Promise<Address>;
  treasuryAddress(): Address;
  chainId(): Promise<number>;
  payment(id: bigint): Promise<OnchainPayment>;
  /** Last payment id issued by the contract. */
  paymentCount(): Promise<bigint>;
  paymentAudit(id: bigint): Promise<{ status: AuditStatus; reportHash: Hex }>;
  perTxCap(): Promise<bigint>;
  auditPayment(args: { key: string; paymentId: bigint; cleared: boolean; reportHash: Hex }, db: Db): Promise<AuditPaymentResult>;
  /** The treasury's wARS balance at a block. */
  treasuryBalanceAt(block: bigint): Promise<bigint>;
}

export interface AuditorDeps {
  db: Db;
  chain: AuditorChain;
  /** Loads a stored invoice file (Vercel Blob URL, or file: on local disk). */
  loadFile(url: string): Promise<InvoiceFile>;
  /** Reads the ARCA QR only. */
  readQr(file: InvoiceFile): Promise<InvoiceFields | null>;
  notify: Notifier;
  now: () => Date;
  appUrl: string;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

const mimeOf = (url: string) => MIME_BY_EXT[url.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export async function loadStoredFile(url: string): Promise<InvoiceFile> {
  if (url.startsWith("file:")) {
    return { bytes: new Uint8Array(await readFile(url.slice("file:".length))), mimeType: mimeOf(url) };
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`file ${url}: HTTP ${res.status}`);
  const type = res.headers.get("content-type")?.split(";")[0].trim();
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: type && type !== "application/octet-stream" ? type : mimeOf(url) };
}

/** Module 03 behind the port, signing with the auditor's key. Imported lazily, like the agent's. */
export function auditorChainPort(): AuditorChain {
  return {
    async self() {
      const { auditorAccount } = await import("@/lib/chain/clients");
      return auditorAccount().address;
    },
    async treasuryAuditor() {
      const [{ publicClient, addressFromEnv }, { treasuryPolicyAbi }] = await Promise.all([
        import("@/lib/chain/clients"),
        import("@/lib/chain/abi"),
      ]);
      return publicClient().readContract({ address: addressFromEnv("TREASURY_ADDRESS"), abi: treasuryPolicyAbi, functionName: "auditor" });
    },
    treasuryAddress() {
      return env().TREASURY_ADDRESS as Address;
    },
    async chainId() {
      const { publicClient } = await import("@/lib/chain/clients");
      return publicClient().getChainId();
    },
    async payment(id) {
      const { getPayment } = await import("@/lib/chain/treasury");
      return getPayment(id);
    },
    async paymentCount() {
      const [{ publicClient, addressFromEnv }, { treasuryPolicyAbi }] = await Promise.all([
        import("@/lib/chain/clients"),
        import("@/lib/chain/abi"),
      ]);
      return publicClient().readContract({ address: addressFromEnv("TREASURY_ADDRESS"), abi: treasuryPolicyAbi, functionName: "paymentCount" });
    },
    async paymentAudit(id) {
      const { getPaymentAudit } = await import("@/lib/chain/treasury");
      return getPaymentAudit(id);
    },
    async perTxCap() {
      const [{ publicClient, addressFromEnv }, { treasuryPolicyAbi }] = await Promise.all([
        import("@/lib/chain/clients"),
        import("@/lib/chain/abi"),
      ]);
      return publicClient().readContract({ address: addressFromEnv("TREASURY_ADDRESS"), abi: treasuryPolicyAbi, functionName: "perTxCap" });
    },
    async auditPayment(args, db) {
      const { auditPayment } = await import("@/lib/chain/auditor");
      return auditPayment(args, { db });
    },
    async treasuryBalanceAt(block) {
      const [{ publicClient, addressFromEnv }, { warsAddress }] = await Promise.all([
        import("@/lib/chain/clients"),
        import("@/lib/chain/treasury"),
      ]);
      const { erc20Abi } = await import("viem");
      return publicClient().readContract({
        address: await warsAddress(),
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [addressFromEnv("TREASURY_ADDRESS")],
        blockNumber: block,
      });
    },
  };
}

export function defaultAuditorDeps(args: { db: Db; notify: Notifier } & Partial<AuditorDeps>): AuditorDeps {
  return {
    chain: auditorChainPort(),
    loadFile: loadStoredFile,
    readQr: async (file) => (await import("@/lib/invoice")).readArcaQr(file),
    now: () => new Date(),
    appUrl: env().APP_URL,
    ...args,
  };
}

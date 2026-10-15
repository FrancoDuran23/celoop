// Agent transactions. Every send is idempotent by key (table agent_txs), carries the ERC-8021
// tag and, when FEE_CURRENCY is set, pays fees in that token as a CIP-64 transaction.
// The auditor sends through the same path with its own account (opts.account).
//
// State machine of an agent_txs row:
//   (none) ──insert──▶ sending ──receipt──▶ mined | reverted
//                         └──simulation or broadcast error──▶ failed
// The tx hash and nonce are stored before broadcasting, so a `sending` row with a hash is never
// resent: we only wait for that hash. A `sending` row without a hash was never broadcast and is
// retried only when the agent has nothing pending in the mempool. `failed` and `reverted` rows are
// retried from scratch (simulation first); the contract itself refuses to pay an invoice twice.
import { and, eq, sql } from "drizzle-orm";
import {
  decodeEventLog,
  encodeFunctionData,
  isAddressEqual,
  keccak256,
  zeroAddress,
  type Address,
  type Hex,
  type LocalAccount,
  type TransactionReceipt,
} from "viem";
import { getDb, type Db } from "@/db";
import { agentTxs } from "@/db/schema";
import { env } from "@/lib/env";
import { boxFactoryAbi, treasuryPolicyAbi } from "./abi";
import { withAttribution } from "./attribution";
import { addressFromEnv, agentAccount, agentWalletClient, publicClient } from "./clients";
import { boxAddress, warsBalanceOf } from "./treasury";

export type AgentTxOptions = {
  /** Defaults to getDb() (Neon). Tests pass a PGlite Db. */
  db?: Db;
  /** How long to wait for a receipt before giving up with AgentTxPendingError. Default 60 s. */
  receiptTimeoutMs?: number;
  /** Who signs. Defaults to the agent (AGENT_PRIVATE_KEY); the auditor passes auditorAccount(). */
  account?: LocalAccount;
};

export type AgentTxResult = { txHash: Hex; receipt: TransactionReceipt } | { dryRun: true };

/** The transaction is (or may be) in flight; try again later with the same key. */
export class AgentTxPendingError extends Error {
  constructor(
    readonly key: string,
    readonly txHash: Hex | null,
    reason: string,
  ) {
    super(`agent tx ${key} is still pending: ${reason}`);
    this.name = "AgentTxPendingError";
  }
}

/** The transaction was mined and reverted. Calling again with the same key retries it. */
export class AgentTxRevertedError extends Error {
  constructor(
    readonly key: string,
    readonly txHash: Hex,
    readonly receipt: TransactionReceipt,
  ) {
    super(`agent tx ${key} reverted (${txHash})`);
    this.name = "AgentTxRevertedError";
  }
}

const DEFAULT_RECEIPT_TIMEOUT_MS = 60_000;
/** A `sending` row without a hash younger than this may still belong to a live process. */
export const STALE_SENDING_MS = 30_000;

const sendEnabled = () => env().AGENT_SEND === "on";

const errorText = (e: unknown) =>
  (e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e)).slice(0, 2000);

type Row = typeof agentTxs.$inferSelect;

async function findRow(db: Db, key: string): Promise<Row | undefined> {
  const [row] = await db.select().from(agentTxs).where(eq(agentTxs.key, key));
  return row;
}

async function updateRow(db: Db, key: string, set: Partial<Omit<Row, "id" | "key" | "createdAt">>) {
  await db
    .update(agentTxs)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(agentTxs.key, key));
}

/** Waits for the receipt of a stored hash and records the final status. */
async function settle(db: Db, key: string, txHash: Hex, timeoutMs: number) {
  const receipt = await pollReceipt(txHash, timeoutMs);
  if (!receipt) throw new AgentTxPendingError(key, txHash, `no receipt after ${timeoutMs} ms`);
  if (receipt.status === "reverted") {
    await updateRow(db, key, { status: "reverted", error: "reverted on chain" });
    throw new AgentTxRevertedError(key, txHash, receipt);
  }
  await updateRow(db, key, { status: "mined", error: null });
  return { txHash, receipt };
}

/**
 * Polls eth_getTransactionReceipt directly. viem's waitForTransactionReceipt watches blocks and can
 * miss them on an anvil fork that mines on demand; polling the receipt works everywhere.
 */
async function pollReceipt(txHash: Hex, timeoutMs: number): Promise<TransactionReceipt | null> {
  const client = publicClient();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await client.getTransactionReceipt({ hash: txHash });
    } catch {
      // not mined yet (or a transient RPC error): keep polling until the deadline
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function agentHasPendingTxs(address: Address): Promise<boolean> {
  const client = publicClient();
  const [pending, latest] = await Promise.all([
    client.getTransactionCount({ address, blockTag: "pending" }),
    client.getTransactionCount({ address, blockTag: "latest" }),
  ]);
  return pending !== latest;
}

/**
 * viem's prepareTransactionRequest also fills a legacy `gasPrice`, which the CIP-64 serializer
 * rejects. Drop it and mark the request as CIP-64 (type 0x7b) explicitly.
 */
export function asCip64<T extends object>(request: T): Omit<T, "gasPrice" | "type"> & { type: "cip64" } {
  const rest = { ...request } as Record<string, unknown>;
  delete rest.gasPrice;
  return { ...(rest as Omit<T, "gasPrice" | "type">), type: "cip64" };
}

/**
 * Prepares and signs (does not send) an agent transaction with `data` as given (already tagged).
 * Uses the pending nonce unless one is passed. With FEE_CURRENCY set it is a CIP-64 transaction.
 */
export async function signAgentTx(args: { to: Address; data: Hex; nonce?: number; account?: LocalAccount }): Promise<{
  serialized: Hex;
  nonce: number;
}> {
  const account = args.account ?? agentAccount();
  const wallet = await agentWalletClient(account);
  const feeCurrency = env().FEE_CURRENCY as Address | undefined;
  const nonce =
    args.nonce ?? (await publicClient().getTransactionCount({ address: account.address, blockTag: "pending" }));
  // feeCurrency is understood by viem's Celo formatters, fee estimation and CIP-64 serializer.
  const request = await wallet.prepareTransactionRequest({
    account,
    chain: wallet.chain,
    to: args.to,
    data: args.data,
    nonce,
    ...(feeCurrency ? { feeCurrency } : {}),
  } as Parameters<typeof wallet.prepareTransactionRequest>[0]);
  const serialized = await wallet.signTransaction(
    (feeCurrency ? asCip64(request) : request) as Parameters<typeof wallet.signTransaction>[0],
  );
  return { serialized, nonce };
}

/** Simulates, signs, stores hash and nonce, broadcasts and waits. The row must be `sending` with no hash. */
async function sendFresh(
  db: Db,
  args: { key: string; to: Address; data: Hex },
  timeoutMs: number,
  account: LocalAccount,
) {
  const client = publicClient();
  const data = withAttribution(args.data);

  try {
    await client.call({ account: account.address, to: args.to, data });
  } catch (e) {
    await updateRow(db, args.key, { status: "failed", error: `simulation: ${errorText(e)}` });
    throw e;
  }

  let serialized: Hex;
  let nonce: number;
  try {
    ({ serialized, nonce } = await signAgentTx({ to: args.to, data, account }));
  } catch (e) {
    await updateRow(db, args.key, { status: "failed", error: `prepare: ${errorText(e)}` });
    throw e;
  }

  const txHash = keccak256(serialized);
  await updateRow(db, args.key, { txHash, nonce, error: null });

  try {
    await client.sendRawTransaction({ serializedTransaction: serialized });
  } catch (e) {
    // If the node has it anyway (e.g. a timeout after acceptance), keep waiting for it.
    const known = await client.getTransaction({ hash: txHash }).then(
      () => true,
      () => false,
    );
    if (!known) {
      await updateRow(db, args.key, { status: "failed", error: `broadcast: ${errorText(e)}` });
      throw e;
    }
  }
  return settle(db, args.key, txHash, timeoutMs);
}

/**
 * Sends one agent transaction, idempotent by `key`.
 * With AGENT_SEND !== "on" it only simulates (eth_call) and returns { dryRun: true }, writing nothing.
 */
export async function sendAgentTx(
  args: { key: string; kind: string; to: Address; data: Hex },
  opts: AgentTxOptions = {},
): Promise<AgentTxResult> {
  const db = opts.db ?? getDb();
  const timeoutMs = opts.receiptTimeoutMs ?? DEFAULT_RECEIPT_TIMEOUT_MS;
  const account = opts.account ?? agentAccount();

  let row = await findRow(db, args.key);

  if (row?.status === "mined" && row.txHash) {
    const txHash = row.txHash as Hex;
    return { txHash, receipt: await publicClient().getTransactionReceipt({ hash: txHash }) };
  }
  if (row?.status === "sending" && row.txHash) {
    return settle(db, args.key, row.txHash as Hex, timeoutMs);
  }

  if (!sendEnabled()) {
    await publicClient().call({ account: account.address, to: args.to, data: withAttribution(args.data) });
    return { dryRun: true };
  }

  if (!row) {
    const inserted = await db
      .insert(agentTxs)
      .values({ key: args.key, kind: args.kind, status: "sending", updatedAt: new Date() })
      .onConflictDoNothing({ target: agentTxs.key })
      .returning();
    if (inserted.length > 0) return sendFresh(db, args, timeoutMs, account);
    // Someone else inserted it between our read and our insert: treat it as theirs.
    row = await findRow(db, args.key);
    if (row?.status === "sending" && row.txHash) return settle(db, args.key, row.txHash as Hex, timeoutMs);
    throw new AgentTxPendingError(args.key, null, "another process is sending this key");
  }

  if (row.status === "sending") {
    // No hash recorded: it was never broadcast. A fresh row may still be simulating in another
    // process, so only stale rows are retried, and only with nothing of the agent's in flight.
    if (Date.now() - row.updatedAt.getTime() < STALE_SENDING_MS) {
      throw new AgentTxPendingError(args.key, null, "another process is sending this key");
    }
    if (await agentHasPendingTxs(account.address)) {
      throw new AgentTxPendingError(args.key, null, "the agent has transactions pending in the mempool");
    }
  }
  // failed, reverted, or a stale sending without a hash: start over, if we win the claim.
  const claimed = await db
    .update(agentTxs)
    .set({ status: "sending", txHash: null, nonce: null, error: null, updatedAt: new Date() })
    .where(
      and(
        eq(agentTxs.key, args.key),
        eq(agentTxs.status, row.status),
        // Drivers hand back millisecond Dates; Postgres keeps microseconds.
        sql`date_trunc('milliseconds', ${agentTxs.updatedAt}) = ${row.updatedAt.toISOString()}::timestamptz`,
      ),
    )
    .returning({ id: agentTxs.id });
  if (claimed.length === 0) throw new AgentTxPendingError(args.key, null, "another process is retrying this key");
  return sendFresh(db, args, timeoutMs, account);
}

/** Fiscal identity of an invoice, as the contract takes it. */
export type InvoiceKey = { cuit: bigint; tipo: number; ptoVta: number; nro: bigint };

export type ProposePaymentResult = {
  /** auditing = pending until the auditor clears or flags it (the treasury has an auditor). */
  status: "executed" | "pending" | "auditing" | "dry-run";
  paymentId?: bigint;
  txHash?: Hex;
};

/** Calls TreasuryPolicy.proposePayment and reads paymentId and the outcome from the receipt. */
export async function proposePayment(
  args: { key: string; vendor: Address; invoice: InvoiceKey; amount: bigint; lineId: Hex; fileHash: Hex },
  opts: AgentTxOptions = {},
): Promise<ProposePaymentResult> {
  const treasury = addressFromEnv("TREASURY_ADDRESS");
  const data = encodeFunctionData({
    abi: treasuryPolicyAbi,
    functionName: "proposePayment",
    args: [args.vendor, args.invoice, args.amount, args.lineId, args.fileHash],
  });
  const result = await sendAgentTx({ key: args.key, kind: "propose", to: treasury, data }, opts);
  if ("dryRun" in result) return { status: "dry-run" };

  let paymentId: bigint | undefined;
  let executed = false;
  for (const log of result.receipt.logs) {
    if (!isAddressEqual(log.address, treasury)) continue;
    try {
      const ev = decodeEventLog({ abi: treasuryPolicyAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "PaymentProposed") paymentId = ev.args.paymentId;
      if (ev.eventName === "PaymentExecuted") {
        paymentId = ev.args.paymentId;
        executed = true;
      }
    } catch {
      // not one of ours
    }
  }
  if (executed) return { status: "executed", paymentId, txHash: result.txHash };
  const auditor = await publicClient().readContract({
    address: treasury,
    abi: treasuryPolicyAbi,
    functionName: "auditor",
    blockNumber: result.receipt.blockNumber,
  });
  const status = isAddressEqual(auditor, zeroAddress) ? "pending" : "auditing";
  return { status, paymentId, txHash: result.txHash };
}

export type SweepBoxResult = { status: "swept" | "empty" | "dry-run"; amount?: bigint; txHash?: Hex };

/** Sweeps the deposit box of `ref` into the treasury. Sends nothing when the box is empty. */
export async function sweepBox(args: { key: string; ref: Hex }, opts: AgentTxOptions = {}): Promise<SweepBoxResult> {
  const db = opts.db ?? getDb();
  const factory = addressFromEnv("BOX_FACTORY_ADDRESS");
  const data = encodeFunctionData({ abi: boxFactoryAbi, functionName: "sweep", args: [args.ref] });

  // A key already mined or in flight returns its own result; the box is empty by now.
  const existing = await findRow(db, args.key);
  let balance: bigint | undefined;
  if (!(existing && (existing.status === "mined" || (existing.status === "sending" && existing.txHash)))) {
    balance = await warsBalanceOf(await boxAddress(args.ref));
    if (balance === BigInt(0)) return { status: "empty", amount: BigInt(0) };
  }

  const result = await sendAgentTx({ key: args.key, kind: "sweep", to: factory, data }, { ...opts, db });
  if ("dryRun" in result) return { status: "dry-run", amount: balance };

  let amount: bigint | undefined;
  for (const log of result.receipt.logs) {
    if (!isAddressEqual(log.address, factory)) continue;
    try {
      const ev = decodeEventLog({ abi: boxFactoryAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "BoxSwept") amount = ev.args.amount;
    } catch {
      // not one of ours
    }
  }
  return { status: "swept", amount, txHash: result.txHash };
}

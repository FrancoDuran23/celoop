// Event indexer: copies the treasury's history into Postgres.
//
// Each log is applied once: its derived writes (contributions, payments, approvals, proposals)
// run first and the chain_events row is written last, so a log with a chain_events row is
// complete and is skipped on a rerun. Every derived write is also idempotent on its own
// ((txHash, logIndex) unique indexes, upserts by id), so a crash halfway is safe to replay.
import { and, between, eq, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import type { Db } from "@/db";
import {
  approvals,
  budgetIndex,
  chainEvents,
  contributionIntents,
  contributions,
  indexerCursor,
  payments,
  proposals,
} from "@/db/schema";
import { required } from "@/lib/env";
import { decodeLog, decodeProposalData, proposalKindName, toJson, type DecodedLog } from "./decode";
import { chainSource, type IndexerSource } from "./source";

export { chainSource, type IndexerSource, type RawLog } from "./source";
export { decodeProposalData, PROPOSAL_KINDS } from "./decode";

export const CURSOR_KEY = "treasury";
const DEFAULT_MAX_BLOCKS = BigInt(5000);
const ONE = BigInt(1);

export type IndexerOptions = {
  /** Blocks per getLogs range. Default 5,000. */
  maxBlocks?: bigint;
  /** Defaults to chainSource() (Celo via viem). */
  source?: IndexerSource;
};

/**
 * Indexes from the cursor (or DEPLOY_BLOCK on the first run) up to latest - 1, in ranges of
 * `maxBlocks`, moving the cursor after each range. Returns the block span covered and how many
 * new events were applied (`to < from` when there was nothing new).
 */
export async function runIndexer(
  db: Db,
  opts: IndexerOptions = {},
): Promise<{ from: bigint; to: bigint; events: number }> {
  const source = opts.source ?? chainSource();
  const maxBlocks = opts.maxBlocks && opts.maxBlocks > BigInt(0) ? opts.maxBlocks : DEFAULT_MAX_BLOCKS;

  const [cursor] = await db.select().from(indexerCursor).where(eq(indexerCursor.key, CURSOR_KEY));
  const from = cursor ? cursor.blockNumber + ONE : required("DEPLOY_BLOCK");
  const target = (await source.latestBlock()) - ONE;

  let events = 0;
  let start = from;
  while (start <= target) {
    const end = start + maxBlocks - ONE < target ? start + maxBlocks - ONE : target;
    events += await indexRange(db, source, start, end);
    await db
      .insert(indexerCursor)
      .values({ key: CURSOR_KEY, blockNumber: end, updatedAt: new Date() })
      .onConflictDoUpdate({ target: indexerCursor.key, set: { blockNumber: end, updatedAt: new Date() } });
    start = end + ONE;
  }
  return { from, to: target >= from ? target : from - ONE, events };
}

/** Applies the logs of [from, to]. Returns how many were new. */
export async function indexRange(db: Db, source: IndexerSource, from: bigint, to: bigint): Promise<number> {
  const addresses = await source.addresses();
  const raw = await source.getLogs(from, to);
  const logs = raw
    .map((l) => decodeLog(l, addresses))
    .filter((l): l is DecodedLog => l !== null)
    .sort((a, b) =>
      a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
    );
  if (logs.length === 0) return 0;

  const seen = new Set(
    (
      await db
        .select({ txHash: chainEvents.txHash, logIndex: chainEvents.logIndex })
        .from(chainEvents)
        .where(between(chainEvents.blockNumber, from, to))
    ).map((r) => `${r.txHash.toLowerCase()}:${r.logIndex}`),
  );

  const unidentified = unidentifiedTransfers(logs);
  const blockTimes = new Map<bigint, Date>();
  const blockTime = async (n: bigint) => {
    let t = blockTimes.get(n);
    if (!t) {
      t = await source.blockTime(n);
      blockTimes.set(n, t);
    }
    return t;
  };

  // Lines touched in this range (new or replayed), re-read from the contract at the end.
  const touchedLines = new Set<Hex>();
  let applied = 0;

  for (const log of logs) {
    const a = log.args;
    if (log.eventName === "BudgetSet") touchedLines.add(a.lineId as Hex);
    if (log.eventName === "BudgetMoved") {
      touchedLines.add(a.fromLine as Hex);
      touchedLines.add(a.toLine as Hex);
    }
    if (log.eventName === "PaymentExecuted") touchedLines.add(a.lineId as Hex);

    if (seen.has(`${log.transactionHash.toLowerCase()}:${log.logIndex}`)) continue;

    const occurredAt = await blockTime(log.blockNumber);
    await applyLog(db, log, occurredAt, unidentified);
    await db
      .insert(chainEvents)
      .values({
        blockNumber: log.blockNumber,
        blockTime: occurredAt,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        address: log.address,
        eventName: log.eventName,
        args: toJson(a) as Record<string, unknown>,
      })
      .onConflictDoNothing();
    applied++;
  }

  for (const lineId of touchedLines) {
    const b = await source.readBudget(lineId);
    const values = {
      allocated: b.allocated.toString(),
      spent: b.spent.toString(),
      periodEnd: Number(b.periodEnd),
      updatedAt: new Date(),
    };
    await db
      .insert(budgetIndex)
      .values({ lineId, ...values })
      .onConflictDoUpdate({ target: budgetIndex.lineId, set: values });
  }
  return applied;
}

/**
 * wARS Transfers to the treasury that no Contribution in the same transaction accounts for.
 * Each Contribution consumes one Transfer of the same amount (contribute() emits both).
 */
function unidentifiedTransfers(logs: DecodedLog[]): Set<DecodedLog> {
  const byTx = new Map<string, DecodedLog[]>();
  for (const log of logs) {
    const k = log.transactionHash.toLowerCase();
    byTx.set(k, [...(byTx.get(k) ?? []), log]);
  }
  const result = new Set<DecodedLog>();
  for (const txLogs of byTx.values()) {
    const contributed = txLogs.filter((l) => l.eventName === "Contribution").map((l) => l.args.amount as bigint);
    for (const t of txLogs.filter((l) => l.eventName === "Transfer")) {
      const i = contributed.indexOf(t.args.value as bigint);
      if (i >= 0) contributed.splice(i, 1);
      else result.add(t);
    }
  }
  return result;
}

const RULES = ["auto", "signers"] as const;

async function applyLog(db: Db, log: DecodedLog, occurredAt: Date, unidentified: Set<DecodedLog>) {
  const a = log.args;
  const txHash = log.transactionHash;
  const logIndex = log.logIndex;

  switch (log.eventName) {
    case "Contribution": {
      const ref = (a.ref as Hex).toLowerCase();
      const [intent] = await db
        .select()
        .from(contributionIntents)
        .where(sql`lower(${contributionIntents.ref}) = ${ref}`);
      await db
        .insert(contributions)
        .values({
          ref: intent?.ref ?? ref,
          personId: intent?.personId ?? null,
          amount: (a.amount as bigint).toString(),
          kind: "dinero",
          txHash,
          logIndex,
          blockNumber: log.blockNumber,
          occurredAt,
        })
        .onConflictDoNothing();
      if (intent) {
        await db
          .update(contributionIntents)
          .set({ status: "swept", sweptTxHash: txHash })
          .where(eq(contributionIntents.ref, intent.ref));
      }
      return;
    }

    case "Transfer": {
      if (!unidentified.has(log)) return;
      await db
        .insert(contributions)
        .values({
          ref: null,
          personId: null,
          amount: (a.value as bigint).toString(),
          kind: "dinero",
          txHash,
          logIndex,
          blockNumber: log.blockNumber,
          occurredAt,
        })
        .onConflictDoNothing();
      return;
    }

    case "PaymentProposed": {
      await db
        .insert(payments)
        .values({
          paymentId: a.paymentId as bigint,
          vendor: a.vendor as Address,
          amount: (a.amount as bigint).toString(),
          lineId: a.lineId as Hex,
          invoiceId: a.invoiceId as Hex,
          fileHash: a.fileHash as Hex,
          status: "pending",
          proposedTxHash: txHash,
        })
        // Never touches status: a replay must not undo a later execution.
        .onConflictDoUpdate({ target: payments.paymentId, set: { proposedTxHash: txHash } });
      return;
    }

    case "PaymentExecuted": {
      const executed = {
        status: "executed",
        rule: RULES[Number(a.rule)] ?? String(a.rule),
        overBudget: a.overBudget as boolean,
        budgetExpired: a.budgetExpired as boolean,
        executedTxHash: txHash,
        executedAt: occurredAt,
        updatedAt: new Date(),
      };
      await db
        .insert(payments)
        .values({
          paymentId: a.paymentId as bigint,
          vendor: a.vendor as Address,
          amount: (a.amount as bigint).toString(),
          lineId: a.lineId as Hex,
          invoiceId: a.invoiceId as Hex,
          fileHash: a.fileHash as Hex,
          ...executed,
        })
        .onConflictDoUpdate({ target: payments.paymentId, set: executed });
      return;
    }

    case "PaymentApproved": {
      await db
        .update(payments)
        .set({ approvals: Number(a.approvals), updatedAt: new Date() })
        .where(eq(payments.paymentId, a.paymentId as bigint));
      await insertApproval(db, "payment", a.paymentId as bigint, a.signer as Address, txHash, logIndex, occurredAt);
      return;
    }

    case "PaymentRejected": {
      await db
        .update(payments)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(and(eq(payments.paymentId, a.paymentId as bigint), eq(payments.status, "pending")));
      return;
    }

    case "PaymentAudited": {
      await db
        .update(payments)
        .set({
          audit: a.cleared ? "cleared" : "flagged",
          auditReportHash: a.reportHash as Hex,
          auditTxHash: txHash,
          updatedAt: new Date(),
        })
        .where(eq(payments.paymentId, a.paymentId as bigint));
      return;
    }

    case "ProposalCreated": {
      const kind = Number(a.kind);
      await db
        .insert(proposals)
        .values({
          proposalId: a.proposalId as bigint,
          kind: proposalKindName(kind),
          data: a.data as Hex,
          decoded: decodeProposalData(kind, a.data as Hex),
          proposer: a.proposer as Address,
          approvals: 1, // the proposer's vote counts
          status: "open",
          createdTxHash: txHash,
        })
        // The signing page may have inserted the row first with only its reasonText; fill in the
        // event's fields but never touch reasonText, approvals or status.
        .onConflictDoUpdate({
          target: proposals.proposalId,
          set: {
            kind: proposalKindName(kind),
            data: a.data as Hex,
            decoded: decodeProposalData(kind, a.data as Hex),
            proposer: a.proposer as Address,
            createdTxHash: txHash,
          },
        });
      return;
    }

    case "ProposalApproved": {
      await db
        .update(proposals)
        .set({ approvals: Number(a.approvals), updatedAt: new Date() })
        .where(eq(proposals.proposalId, a.proposalId as bigint));
      await insertApproval(db, "proposal", a.proposalId as bigint, a.signer as Address, txHash, logIndex, occurredAt);
      return;
    }

    case "ProposalExecuted": {
      await db
        .update(proposals)
        .set({ status: "executed", executedTxHash: txHash, updatedAt: new Date() })
        .where(eq(proposals.proposalId, a.proposalId as bigint));
      return;
    }

    // BudgetSet / BudgetMoved refresh budget_index from the contract (see indexRange).
    // BoxSwept, VendorSet, CapsSet, SignersSet, AgentSet, AuditorSet, ConfigHashSet, Paused,
    // Unpaused: chain_events only.
    default:
      return;
  }
}

async function insertApproval(
  db: Db,
  target: "payment" | "proposal",
  targetId: bigint,
  signer: Address,
  txHash: Hex,
  logIndex: number,
  occurredAt: Date,
) {
  await db
    .insert(approvals)
    .values({ target, targetId, signer, txHash, logIndex, occurredAt })
    .onConflictDoNothing();
}

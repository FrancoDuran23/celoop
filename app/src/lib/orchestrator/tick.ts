// The periodic tick (POST /api/tick, every minute). Runs under the "tick" lease lock and is
// idempotent: every message it sends is claimed in the database before it goes out, so two runs
// in a row never repeat a receipt or an alert.
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { agentTxs, budgetIndex, budgetLines, contributionIntents, contributions, cooperadora, reports } from "@/db/schema";
import { withLock } from "@/lib/locks";
import { activeCooperadoras, readJobCursor, rotateAfter, tickLock, writeJobCursor } from "@/lib/tenant";
import { explorerTxUrl, formatDate, periodLabelEs, periodRange, previousPeriod } from "@/lib/report/format";
import { notifyOnce, type AgentDeps } from "./deps";
import { claimNotice, releaseNotice } from "./chat-state";
import { arDate, errorText, formatPesos } from "./format";
import { AGENT_TX_LOCK, AGENT_TX_LOCK_MS, syncInvoices } from "./invoice";
import { reviewUrl, urls } from "./links";
import { COMMISSION_ROLES, OPERATOR_ROLE, personsWithRoles, REVIEWER_ROLE } from "./people";

/** @deprecated Per-cooperative locks are `tick:<id>`. Kept so older callers can still name the idea. */
export const TICK_LOCK = "tick";
export const TICK_LOCK_MS = 300_000;
/** Leave headroom under the 300s function limit. */
export const TICK_BUDGET_MS = 240_000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const INTENT_TTL_MS = 7 * DAY_MS;
export const STUCK_SENDING_MS = 10 * 60 * 1000;
const BUDGET_ALERT_PERCENT = BigInt(80);
const ZERO = BigInt(0);

export type TickSummary = {
  ok: true;
  steps: Record<string, unknown>;
  errors: string[];
};

export async function runTick(deps: AgentDeps): Promise<TickSummary | { skipped: true }> {
  const coops = await activeCooperadoras(deps.db);
  const budget = deps.tickBudgetMs ?? TICK_BUDGET_MS;
  const started = Date.now();
  const ordered = rotateAfter(coops, await readJobCursor(deps.db, "tick"));
  const perCoop: Record<string, unknown>[] = [];
  const errors: string[] = [];
  let ran = 0;

  for (const coop of ordered) {
    if (ran > 0 && Date.now() - started > budget) {
      perCoop.push({ id: coop.id, deferred: true });
      continue;
    }
    const chain =
      deps.chainFor && coop.treasuryAddress && coop.boxFactoryAddress
        ? deps.chainFor({
            treasury: coop.treasuryAddress as Address,
            boxFactory: coop.boxFactoryAddress as Address,
          })
        : deps.chain;
    const result = await withLock(deps.db, tickLock(coop.id), TICK_LOCK_MS, () =>
      tickOne({ ...deps, cooperadoraId: coop.id, chain }),
    );
    if (result && typeof result === "object" && "skipped" in result) {
      perCoop.push({ id: coop.id, skipped: true });
      continue;
    }
    ran++;
    perCoop.push({ id: coop.id, ...(result as TickSummary) });
    errors.push(...(result as TickSummary).errors.map((e) => (coops.length === 1 ? e : `#${coop.id} ${e}`)));
    await writeJobCursor(deps.db, "tick", coop.id);
  }

  if (ran === 0) return { skipped: true };
  if (coops.length === 1) {
    const only = perCoop[0] as { steps?: TickSummary["steps"]; errors?: string[] };
    return { ok: true, steps: only.steps ?? {}, errors };
  }
  return { ok: true, steps: { cooperadoras: perCoop }, errors };
}

async function tickOne(deps: AgentDeps): Promise<TickSummary> {
  const steps: Record<string, unknown> = {};
  const errors: string[] = [];
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      const r = await fn();
      steps[name] = r ?? "ok";
      return r;
    } catch (e) {
      console.error(`tick ${name}: ${errorText(e)}`);
      errors.push(`${name}: ${errorText(e)}`);
      return undefined;
    }
  };

  await step("indexer", () => deps.indexer(deps.cooperadoraId));
  const sweeps = await step("sweeps", () => sweepBoxes(deps));
  const late = await step("expiredSweeps", () => sweepExpiredBoxes(deps));
  // Index right away what we just swept, so the receipt goes out in this same tick.
  if ((sweeps?.swept ?? 0) + (late?.swept ?? 0) > 0) await step("indexerAfterSweeps", () => deps.indexer(deps.cooperadoraId));
  await step("receipts", () => sendReceipts(deps));
  await step("invoices", () => syncInvoices(deps));
  await step("monthClose", () => closeMonth(deps));
  await step("publish", () => publishReviewed(deps));
  await step("budgetAlerts", () => budgetAlerts(deps));
  await step("stuckTxs", () => stuckTxs(deps));
  return { ok: true as const, steps, errors };
}

/**
 * Step 2: sweeps boxes with a balance. The key includes how many contributions that box already
 * produced and its balance, so a second deposit in the same box gets a fresh key, while a sweep
 * still in flight keeps its key (and is waited for, never resent).
 */
export async function sweepBoxes(deps: AgentDeps): Promise<{ checked: number; swept: number; expired: number; busy: number }> {
  const { db } = deps;
  const now = deps.now();
  const recent = new Date(now.getTime() - INTENT_TTL_MS);
  const intents = await db
    .select()
    .from(contributionIntents)
    .where(
      and(
        deps.cooperadoraId == null ? undefined : eq(contributionIntents.cooperadoraId, deps.cooperadoraId),
        or(
          eq(contributionIntents.status, "open"),
          and(eq(contributionIntents.status, "swept"), gt(contributionIntents.createdAt, recent)),
        ),
      ),
    )
    .orderBy(contributionIntents.createdAt);

  const out = { checked: 0, swept: 0, expired: 0, busy: 0 };
  for (const intent of intents) {
    out.checked++;
    const r = await sweepIntent(deps, intent);
    if (r === "swept") out.swept++;
    else if (r === "busy") out.busy++;
    else if (r === "empty" && intent.status === "open" && intent.createdAt <= recent) {
      await db
        .update(contributionIntents)
        .set({ status: "expired" })
        .where(and(eq(contributionIntents.ref, intent.ref), eq(contributionIntents.status, "open")));
      out.expired++;
    }
  }
  return out;
}

type Intent = typeof contributionIntents.$inferSelect;

/** Sweeps one box if it has money. Serialized with every other agent send. */
async function sweepIntent(deps: AgentDeps, intent: Intent): Promise<"swept" | "busy" | "empty"> {
  const { db } = deps;
  const balance = await deps.chain.balanceOf(intent.boxAddress as Address);
  if (balance === ZERO) return "empty";
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contributions)
    .where(sql`lower(${contributions.ref}) = ${intent.ref.toLowerCase()}`);
  const key = `sweep:${intent.ref}:${n}:${balance}`;
  try {
    const res = await withLock(db, AGENT_TX_LOCK, AGENT_TX_LOCK_MS, () =>
      deps.chain.sweepBox({ key, ref: intent.ref as Hex }, db),
    );
    if ("skipped" in res) return "busy";
    return res.status === "swept" ? "swept" : "empty";
  } catch (e) {
    if (e instanceof Error && e.name === "AgentTxPendingError") return "busy";
    throw e;
  }
}

/** chat_state row for the agent's own once-only markers (Telegram chat ids are never 0). */
export const AGENT_STATE_CHAT = BigInt(0);
export const EXPIRED_RESCAN_MS = 90 * DAY_MS;

/**
 * Once a day (Argentine date), looks at boxes that expired in the last 90 days: a late deposit
 * is swept with the same keys as any other. If something was busy or failed, the day's marker is
 * released so the next tick tries again.
 */
export async function sweepExpiredBoxes(deps: AgentDeps): Promise<{ ran: boolean; checked: number; swept: number; busy: number }> {
  const { db } = deps;
  const now = deps.now();
  const marker = `expired-rescan:${deps.cooperadoraId ?? "all"}:${arDate(now)}`;
  if (!(await claimNotice(db, AGENT_STATE_CHAT, marker))) return { ran: false, checked: 0, swept: 0, busy: 0 };
  const out = { ran: true, checked: 0, swept: 0, busy: 0 };
  try {
    const intents = await db
      .select()
      .from(contributionIntents)
      .where(
        and(
          deps.cooperadoraId == null ? undefined : eq(contributionIntents.cooperadoraId, deps.cooperadoraId),
          eq(contributionIntents.status, "expired"),
          gt(contributionIntents.createdAt, new Date(now.getTime() - EXPIRED_RESCAN_MS)),
        ),
      )
      .orderBy(contributionIntents.createdAt);
    for (const intent of intents) {
      out.checked++;
      const r = await sweepIntent(deps, intent);
      if (r === "swept") out.swept++;
      if (r === "busy") out.busy++;
    }
  } catch (e) {
    await releaseNotice(db, AGENT_STATE_CHAT, marker);
    throw e;
  }
  if (out.busy > 0) await releaseNotice(db, AGENT_STATE_CHAT, marker);
  return out;
}

/** Step 3: one receipt per identified money contribution, claimed before it is sent. */
export async function sendReceipts(deps: AgentDeps): Promise<{ sent: number }> {
  const { db } = deps;
  const rows = await db
    .select()
    .from(contributions)
    .where(
      and(
        deps.cooperadoraId == null ? undefined : eq(contributions.cooperadoraId, deps.cooperadoraId),
        isNotNull(contributions.personId),
        isNull(contributions.receiptSentAt),
        eq(contributions.kind, "dinero"),
        isNotNull(contributions.txHash),
      ),
    )
    .orderBy(contributions.id);
  if (rows.length === 0) return { sent: 0 };
  const [coop] = await db
    .select({ chainId: cooperadora.chainId })
    .from(cooperadora)
    .where(deps.cooperadoraId == null ? undefined : eq(cooperadora.id, deps.cooperadoraId));

  let sent = 0;
  for (const c of rows) {
    const [claimed] = await db
      .update(contributions)
      .set({ receiptSentAt: deps.now() })
      .where(and(eq(contributions.id, c.id), isNull(contributions.receiptSentAt)))
      .returning({ id: contributions.id });
    if (!claimed) continue;
    const link = explorerTxUrl(coop?.chainId, c.txHash) ?? urls.panel(deps.appUrl);
    try {
      await deps.notify(
        c.personId!,
        `Recibimos tu aporte de ${formatPesos(c.amount)} el ${formatDate(c.occurredAt)}. ¡Gracias! Ver movimiento: ${link}`,
      );
      sent++;
    } catch (e) {
      await db.update(contributions).set({ receiptSentAt: null }).where(eq(contributions.id, c.id));
      throw e;
    }
  }
  return { sent };
}

/**
 * Step 5: the first tick of a month closes the previous one (module 05 builds the draft) and
 * sends each revisor a link to review it. Months before the cooperadora existed are skipped.
 */
export async function closeMonth(deps: AgentDeps): Promise<{ period: string; closed: boolean; notified: number }> {
  const { db } = deps;
  const now = deps.now();
  const period = previousPeriod(now);
  const [coop] = await db
    .select()
    .from(cooperadora)
    .where(deps.cooperadoraId == null ? undefined : eq(cooperadora.id, deps.cooperadoraId));
  if (!coop || periodRange(period).end <= coop.createdAt) return { period, closed: false, notified: 0 };

  const reportWhere = and(
    eq(reports.period, period),
    deps.cooperadoraId == null ? undefined : eq(reports.cooperadoraId, deps.cooperadoraId),
  );
  let [row] = await db.select().from(reports).where(reportWhere);
  let closed = false;
  if (!row) {
    await deps.reports.close(period, deps.cooperadoraId);
    closed = true;
    [row] = await db.select().from(reports).where(reportWhere);
  }
  let notified = 0;
  if (row?.status === "borrador") {
    for (const r of await personsWithRoles(db, [REVIEWER_ROLE], deps.cooperadoraId)) {
      const sent = await notifyOnce(deps, r.id, `review:${period}`, async () => ({
        text:
          `Ya está el borrador de la rendición de ${periodLabelEs(period)}. ` +
          `Revisalo con tiempo y, si está todo bien, dale el visto bueno desde la misma página. El link vence en 7 días.`,
        buttons: [[{ text: "Revisar rendición", url: await reviewUrl(db, deps.appUrl, r.id, period, now) }]],
      }));
      if (sent) notified++;
    }
  }
  return { period, closed, notified };
}

/** Reports the revisor approved get published (PDF included) and announced. */
export async function publishReviewed(deps: AgentDeps): Promise<{ published: string[] }> {
  const { db } = deps;
  const published: string[] = [];
  for (const row of await db
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.status, "revisada"),
        deps.cooperadoraId == null ? undefined : eq(reports.cooperadoraId, deps.cooperadoraId),
      ),
    )) {
    const res = await deps.reports.publish(row.period, deps.cooperadoraId);
    if (!res.ok) throw new Error(`publish ${row.period}: ${res.error}`);
    published.push(row.period);
    const people = await personsWithRoles(db, [...COMMISSION_ROLES, REVIEWER_ROLE, "asesor"], deps.cooperadoraId);
    for (const p of people) {
      await notifyOnce(
        deps,
        p.id,
        `published:${row.period}`,
        `Ya está publicada la rendición de ${periodLabelEs(row.period)}, con el visto bueno del revisor. La puede ver cualquiera: ${urls.report(deps.appUrl, row.period)}`,
      );
    }
  }
  return { published };
}

/** Step 6: tells the comisión, once per line and budget period, when a line passes 80%. */
export async function budgetAlerts(deps: AgentDeps): Promise<{ alerts: number }> {
  const { db } = deps;
  const lines = await db
    .select({ lineId: budgetIndex.lineId, allocated: budgetIndex.allocated, spent: budgetIndex.spent, periodEnd: budgetIndex.periodEnd, name: budgetLines.name })
    .from(budgetIndex)
    .where(deps.cooperadoraId == null ? undefined : eq(budgetIndex.cooperadoraId, deps.cooperadoraId))
    .innerJoin(
      budgetLines,
      and(eq(budgetLines.lineId, budgetIndex.lineId), eq(budgetLines.cooperadoraId, budgetIndex.cooperadoraId)),
    );
  let alerts = 0;
  const commission = await personsWithRoles(db, COMMISSION_ROLES, deps.cooperadoraId);
  for (const l of lines) {
    const allocated = BigInt(l.allocated);
    const spent = BigInt(l.spent);
    if (allocated <= ZERO || spent * BigInt(100) < allocated * BUDGET_ALERT_PERCENT) continue;
    const pct = (spent * BigInt(100)) / allocated;
    const left = allocated - spent;
    const text =
      (spent > allocated
        ? `Aviso: la partida ${l.name} ya superó lo asignado (gastado ${formatPesos(spent)} de ${formatPesos(allocated)}).`
        : `Aviso: la partida ${l.name} ya usó el ${pct}% de lo asignado (gastado ${formatPesos(spent)} de ${formatPesos(allocated)}). Quedan ${formatPesos(left)}.`) +
      ` Si hace falta, se puede mover plata entre partidas con «Proponer cambio».`;
    for (const p of commission) {
      if (await notifyOnce(deps, p.id, `budget80:${l.lineId}:${l.periodEnd}`, text)) alerts++;
    }
  }
  return { alerts };
}

/** Agent transactions stuck in `sending` for more than 10 minutes: alert the operator once each. */
export async function stuckTxs(deps: AgentDeps): Promise<{ stuck: number }> {
  const { db } = deps;
  const cutoff = new Date(deps.now().getTime() - STUCK_SENDING_MS);
  const rows = await db
    .select()
    .from(agentTxs)
    .where(
      and(
        deps.cooperadoraId == null ? undefined : eq(agentTxs.cooperadoraId, deps.cooperadoraId),
        eq(agentTxs.status, "sending"),
        lt(agentTxs.updatedAt, cutoff),
      ),
    );
  if (rows.length === 0) return { stuck: 0 };
  const operators = await personsWithRoles(db, [OPERATOR_ROLE], deps.cooperadoraId);
  for (const r of rows) {
    const text =
      `Atención operador: el envío del agente "${r.key}" lleva más de 10 minutos sin confirmarse` +
      `${r.txHash ? ` (tx ${r.txHash}, nonce ${r.nonce ?? "?"})` : " (no llegó a transmitirse)"}. ` +
      `No se reenvía solo; revisalo.`;
    console.error(text);
    for (const op of operators) await notifyOnce(deps, op.id, `stuck:${r.id}:${r.txHash ?? "nohash"}`, text);
  }
  return { stuck: rows.length };
}

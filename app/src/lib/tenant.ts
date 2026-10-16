// Which cooperative a request, a tick or a bot chat is talking about.
// The demo keeps working: one active row is used whenever nobody named one.
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import type { Address } from "viem";
import type { Db } from "@/db";
import { cooperadora, jobCursor } from "@/db/schema";
import { env } from "@/lib/env";

export type CoopRow = typeof cooperadora.$inferSelect;

export function tickLock(cooperadoraId: number): string {
  return `tick:${cooperadoraId}`;
}

export function auditorLock(cooperadoraId: number): string {
  return `auditor:${cooperadoraId}`;
}

/** Active cooperatives that already have a treasury, oldest id first. */
export async function activeCooperadoras(db: Db): Promise<CoopRow[]> {
  return db
    .select()
    .from(cooperadora)
    .where(and(eq(cooperadora.status, "active"), isNotNull(cooperadora.treasuryAddress), isNotNull(cooperadora.boxFactoryAddress)))
    .orderBy(asc(cooperadora.id));
}

export async function cooperadoraById(db: Db, id: number): Promise<CoopRow | undefined> {
  const [row] = await db.select().from(cooperadora).where(eq(cooperadora.id, id));
  return row;
}

/**
 * The cooperative for a page that did not name one: the only active one.
 * Returns undefined when there are none or several (the caller should ask).
 */
export async function soleCooperadora(db: Db): Promise<CoopRow | undefined> {
  const rows = await activeCooperadoras(db);
  return rows.length === 1 ? rows[0] : undefined;
}

/** Route id, else the only active cooperative. */
export async function resolveCooperadora(db: Db, hinted?: number | null): Promise<CoopRow | undefined> {
  if (hinted != null && Number.isInteger(hinted) && hinted > 0) return cooperadoraById(db, hinted);
  return soleCooperadora(db);
}

export async function resolveTreasury(
  db: Db | undefined,
  explicit?: Address | null,
  cooperadoraId?: number,
): Promise<Address> {
  if (explicit) return explicit;
  if (cooperadoraId != null) {
    if (!db) throw new Error("resolveTreasury needs a database to load a cooperadora");
    const row = await cooperadoraById(db, cooperadoraId);
    if (!row?.treasuryAddress) throw new Error(`Cooperadora ${cooperadoraId} has no treasury yet`);
    return row.treasuryAddress as Address;
  }
  const fromEnv = env().TREASURY_ADDRESS;
  if (fromEnv) return fromEnv as Address;
  if (!db) throw new Error("No treasury: set up a cooperadora or FACTORY_ADDRESS and deploy one");
  const sole = await soleCooperadora(db);
  if (!sole?.treasuryAddress) {
    throw new Error("No single active treasury. Open the cooperative from its own link.");
  }
  return sole.treasuryAddress as Address;
}

export async function resolveBoxFactory(
  db: Db | undefined,
  explicit?: Address | null,
  cooperadoraId?: number,
): Promise<Address> {
  if (explicit) return explicit;
  if (cooperadoraId != null) {
    if (!db) throw new Error("resolveBoxFactory needs a database");
    const row = await cooperadoraById(db, cooperadoraId);
    if (!row?.boxFactoryAddress) throw new Error(`Cooperadora ${cooperadoraId} has no box factory yet`);
    return row.boxFactoryAddress as Address;
  }
  const fromEnv = env().BOX_FACTORY_ADDRESS;
  if (fromEnv) return fromEnv as Address;
  if (!db) throw new Error("No box factory");
  const sole = await soleCooperadora(db);
  if (!sole?.boxFactoryAddress) throw new Error("No single active box factory");
  return sole.boxFactoryAddress as Address;
}

/** Continue a batch after `cursor`, wrapping to the start so every cooperative gets a turn. */
export function rotateAfter<T extends { id: number }>(rows: T[], cursor: number | null): T[] {
  if (cursor == null || rows.length === 0) return rows;
  const i = rows.findIndex((r) => r.id > cursor);
  if (i <= 0) return rows;
  return [...rows.slice(i), ...rows.slice(0, i)];
}

export async function readJobCursor(db: Db, name: string): Promise<number | null> {
  const [row] = await db.select().from(jobCursor).where(eq(jobCursor.name, name));
  return row?.position ?? null;
}

export async function writeJobCursor(db: Db, name: string, position: number): Promise<void> {
  await db
    .insert(jobCursor)
    .values({ name, position, updatedAt: new Date() })
    .onConflictDoUpdate({ target: jobCursor.name, set: { position, updatedAt: new Date() } });
}

/** Idempotency keys stay unprefixed for the demo cooperative so in-flight sends are not repeated. */
export function scopedKey(cooperadoraId: number | undefined, key: string): string {
  if (cooperadoraId == null || cooperadoraId === 1) return key;
  return `${cooperadoraId}:${key}`;
}

export async function syncCooperadoraSequence(db: Db): Promise<void> {
  await db.execute(sql`select setval('cooperadora_id_seq', (select coalesce(max(id), 1) from cooperadora))`);
}

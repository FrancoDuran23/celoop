// Lease locks in Postgres so two ticks never run the same work.
// Acquiring is one statement (works on neon-http, which has no interactive transactions):
// insert the lock, or take it over only if the current lease has expired.
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { locks } from "@/db/schema";

async function acquire(db: Db, name: string, holder: string, ttlMs: number): Promise<boolean> {
  const expiresAt = sql`now() + ${Math.max(0, Math.floor(ttlMs))} * interval '1 millisecond'`;
  const rows = await db
    .insert(locks)
    .values({ name, holder, expiresAt })
    .onConflictDoUpdate({
      target: locks.name,
      set: { holder: sql`excluded.holder`, expiresAt: sql`excluded.expires_at` },
      setWhere: sql`${locks.expiresAt} < now()`,
    })
    .returning({ holder: locks.holder });
  return rows.length > 0 && rows[0].holder === holder;
}

async function release(db: Db, name: string, holder: string): Promise<void> {
  // Only our own lease: if it expired and someone else took it, theirs stays.
  await db.delete(locks).where(and(eq(locks.name, name), eq(locks.holder, holder)));
}

/**
 * Runs `fn` holding the lock `name` for at most `ttlMs`. If someone else holds a live lease,
 * returns { skipped: true } without running `fn`. The lock is released when `fn` settles.
 */
export async function withLock<T>(
  db: Db,
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T | { skipped: true }> {
  const holder = randomUUID();
  if (!(await acquire(db, name, holder, ttlMs))) return { skipped: true };
  try {
    return await fn();
  } finally {
    await release(db, name, holder);
  }
}

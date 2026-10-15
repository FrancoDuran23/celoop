import { eq, sql } from "drizzle-orm";
import { beforeEach, expect, test } from "vitest";
import type { Db } from "@/db";
import { locks } from "@/db/schema";
import { createTestDb } from "@/db/testing";
import { withLock } from "./locks";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("runs the function and releases the lock", async () => {
  expect(await withLock(db, "tick", 60_000, async () => 42)).toBe(42);
  expect(await db.select().from(locks)).toEqual([]);
  expect(await withLock(db, "tick", 60_000, async () => "again")).toBe("again");
});

test("a second holder is skipped while the lease is live", async () => {
  let innerRan = false;
  const outer = await withLock(db, "tick", 60_000, async () => {
    const inner = await withLock(db, "tick", 60_000, async () => {
      innerRan = true;
    });
    // A different name is independent.
    const other = await withLock(db, "other", 60_000, async () => "other ran");
    return { inner, other };
  });
  expect(outer).toEqual({ inner: { skipped: true }, other: "other ran" });
  expect(innerRan).toBe(false);
});

test("concurrent attempts: exactly one runs", async () => {
  let running = 0;
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      withLock(db, "tick", 60_000, async () => {
        running++;
        await sleep(30);
        return "ran";
      }),
    ),
  );
  expect(running).toBe(1);
  expect(results.filter((r) => r === "ran")).toHaveLength(1);
});

test("an expired lease can be taken over", async () => {
  await db.insert(locks).values({ name: "tick", holder: "crashed", expiresAt: sql`now() - interval '1 second'` });
  expect(await withLock(db, "tick", 60_000, async () => "took over")).toBe("took over");
  expect(await db.select().from(locks)).toEqual([]);
});

test("a live lease left by a crashed holder blocks until it expires", async () => {
  await db.insert(locks).values({ name: "tick", holder: "crashed", expiresAt: sql`now() + interval '1 hour'` });
  expect(await withLock(db, "tick", 60_000, async () => "ran")).toEqual({ skipped: true });
  const [row] = await db.select().from(locks).where(eq(locks.name, "tick"));
  expect(row.holder).toBe("crashed");
});

test("releasing does not delete a lock now held by someone else", async () => {
  let releaseB!: () => void;
  const bHolds = new Promise<void>((r) => (releaseB = r));
  let bDone: Promise<unknown> = Promise.resolve();

  await withLock(db, "tick", 1, async () => {
    await sleep(20); // A's lease expires while A is still working
    let bStarted!: () => void;
    const started = new Promise<void>((r) => (bStarted = r));
    bDone = withLock(db, "tick", 60_000, async () => {
      bStarted();
      await bHolds;
      return "b";
    });
    await started;
  });

  // A finished and released: B's lease must still be there.
  const rows = await db.select().from(locks);
  expect(rows).toHaveLength(1);
  expect(await withLock(db, "tick", 60_000, async () => "c")).toEqual({ skipped: true });

  releaseB();
  expect(await bDone).toBe("b");
  expect(await db.select().from(locks)).toEqual([]);
});

test("the lock is released when the function throws", async () => {
  await expect(
    withLock(db, "tick", 60_000, async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(await db.select().from(locks)).toEqual([]);
});

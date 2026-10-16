import { PGlite } from "@electric-sql/pglite";
import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import type { Db } from "./index";
import * as schema from "./schema";

/**
 * A parent row so child inserts (default cooperadora_id = 1) satisfy the foreign key.
 * Not called from createTestDb: setup refuses a database that already has a cooperative.
 */
export async function ensureCooperadora(db: Db): Promise<number> {
  const [existing] = await db.select({ id: schema.cooperadora.id }).from(schema.cooperadora).orderBy(asc(schema.cooperadora.id)).limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(schema.cooperadora)
    .values({
      name: "Test co-op",
      school: "Test school",
      cuit: BigInt(30700000001),
      chainId: 31337,
      status: "draft",
    })
    .returning({ id: schema.cooperadora.id });
  return row.id;
}

/** Fresh in-memory Postgres with every migration applied. */
export async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../drizzle") });
  return db as unknown as Db;
}

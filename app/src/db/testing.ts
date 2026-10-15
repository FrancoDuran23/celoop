import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import type { Db } from "./index";
import * as schema from "./schema";

/** Fresh in-memory Postgres with every migration applied. */
export async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(__dirname, "../../drizzle") });
  return db as unknown as Db;
}

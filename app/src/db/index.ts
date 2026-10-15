import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export { schema };

/** Any drizzle Postgres database with this schema: Neon in production, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: Db | undefined;

/**
 * Production database (Neon over HTTP). For local development without Neon, set
 * DATABASE_URL=pglite:./.data/pglite to use the on-disk PGlite that `scripts/setup.ts` seeds
 * (one process at a time). Tests build their own Db with `createTestDb`.
 */
export function getDb(): Db {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    if (url.startsWith("pglite:")) {
      // Loaded lazily so production bundles never pull in PGlite.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { drizzle } = require("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
      cached = drizzle(new PGlite(url.slice("pglite:".length)), { schema }) as unknown as Db;
    } else {
      cached = drizzleNeon(neon(url), { schema }) as unknown as Db;
    }
  }
  return cached;
}

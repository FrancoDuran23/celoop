// Database for the scripts: Neon when DATABASE_URL is set (migrated with drizzle-kit, as in
// production), otherwise a PGlite database on disk (app/.data/pglite) for a local run.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { Db } from "@/db";
import * as schema from "@/db/schema";

export const APP_DIR = path.resolve(__dirname, "../..");
export const REPO_DIR = path.resolve(APP_DIR, "..");
export const DEFAULT_PGLITE_DIR = path.join(APP_DIR, ".data/pglite");
const MIGRATIONS = path.join(APP_DIR, "drizzle");

export type ScriptDb = { db: Db; kind: "neon" | "pglite" | "given"; where: string; close: () => Promise<void> };

export async function openScriptDb(
  opts: { db?: Db; databaseUrl?: string; pgliteDir?: string; fresh?: boolean; log?: (s: string) => void } = {},
): Promise<ScriptDb> {
  const log = opts.log ?? console.log;
  if (opts.db) return { db: opts.db, kind: "given", where: "(en memoria)", close: async () => {} };

  // DATABASE_URL=pglite:<dir> is the local PGlite the app also reads (see src/db/index.ts).
  if (opts.databaseUrl?.startsWith("pglite:")) {
    return openScriptDb({ ...opts, databaseUrl: undefined, pgliteDir: path.resolve(APP_DIR, opts.databaseUrl.slice("pglite:".length)) });
  }

  if (opts.databaseUrl) {
    log("Migrando la base (drizzle-kit migrate)…");
    const r = spawnSync("npx", ["drizzle-kit", "migrate"], {
      cwd: APP_DIR,
      env: { ...process.env, DATABASE_URL: opts.databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    if (r.status !== 0) throw new Error(`drizzle-kit migrate falló:\n${r.stdout}\n${r.stderr}`);
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const db = drizzle(neon(opts.databaseUrl), { schema }) as unknown as Db;
    return { db, kind: "neon", where: new URL(opts.databaseUrl).host, close: async () => {} };
  }

  const dir = opts.pgliteDir ?? DEFAULT_PGLITE_DIR;
  if (opts.fresh && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.dirname(dir), { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  log(`Migrando la base local (PGlite en ${path.relative(process.cwd(), dir) || dir})…`);
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, kind: "pglite", where: dir, close: () => client.close() };
}

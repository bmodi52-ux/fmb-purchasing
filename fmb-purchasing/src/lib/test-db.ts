import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/**
 * A real Postgres, in-process, with every migration applied from scratch.
 *
 * The costing views are where the money arithmetic actually lives, and they
 * could not be tested before this: they are SQL, so exercising them needs a
 * database, and it could not be production because entry numbers come from
 * identity sequences that ROLLBACK does not return — a fixture would burn
 * E-0007 forever and leave a hole in the audit trail those numbers exist to
 * provide.
 *
 * PGlite is Postgres compiled to WASM, so this needs no Docker, no service to
 * start, and no cleanup. Applying the migrations in order rather than loading
 * a dumped schema means the migrations themselves get tested on every run.
 */

const MIGRATIONS_DIR = path.join(import.meta.dirname, "..", "..", "supabase", "migrations");

/**
 * Supabase provides an `auth` schema that vanilla Postgres does not, and nine
 * migrations reference `auth.users`. Only the shape matters here — the app
 * reads identity through `profiles`, and the trigger in 0003 is what links
 * the two — so a stub with the columns the migrations touch is enough.
 */
const AUTH_STUB = `
  create schema if not exists auth;

  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
`;

export type TestDb = PGlite;

/** Every migration file in order, so 0002 never runs before 0010. */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

/**
 * A fresh in-memory database with the full schema applied.
 *
 * Each call is completely isolated — no shared state, no teardown — so tests
 * can insert freely without the sequence-burning problem that rules out
 * testing against the real database.
 */
export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });

  await db.exec(AUTH_STUB);

  for (const file of migrationFiles()) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      // Without the filename a failure here is a wall of anonymous SQL.
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  return db;
}

/** First column of the first row, for the many single-value assertions. */
export async function scalar<T>(db: TestDb, sql: string, params: unknown[] = []): Promise<T> {
  const result = await db.query<Record<string, T>>(sql, params);
  const row = result.rows[0];
  if (row === undefined) throw new Error(`No rows returned by: ${sql}`);
  return Object.values(row)[0];
}

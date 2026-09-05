/**
 * Runs a SQL file against a throwaway database with every migration applied,
 * so maintenance scripts can be proven before anyone pastes them into the
 * production SQL editor.
 *
 *   node scripts/dry-run-sql.mjs supabase/maintenance/verify_costing_views.sql
 *
 * PGlite is Postgres compiled to WASM, so this needs nothing installed and
 * touches nothing real. NOTICE output is printed as it arrives, which is what
 * the RAISE NOTICE lines in those scripts are for.
 *
 * It proves the SQL is valid and does what it claims against this schema. It
 * cannot prove production matches this schema — if a migration was applied by
 * hand there, only running it there will tell you.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const target = process.argv[2];
if (!target) {
  console.error("usage: node scripts/dry-run-sql.mjs <path-to-sql-file>");
  process.exit(1);
}

const root = path.join(import.meta.dirname, "..");
const migrationsDir = path.join(root, "supabase", "migrations");

const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });

// Supabase's auth schema, which vanilla Postgres has no notion of.
await db.exec(`
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
`);

const migrations = readdirSync(migrationsDir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

for (const file of migrations) {
  try {
    await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  } catch (err) {
    console.error(`Migration ${file} failed: ${err.message}`);
    process.exit(1);
  }
}
console.log(`Applied ${migrations.length} migrations.`);

// One account, provisioned through the 0003 trigger the way a real one is.
// Scripts that attribute rows to a person need somebody to attribute them to.
await db.exec(
  `insert into auth.users (email, raw_user_meta_data)
   values ('dry-run@test.local', '{"full_name": "Dry Run"}'::jsonb);`
);

console.log(`\nRunning ${target}\n`);

try {
  const results = await db.exec(readFileSync(path.join(root, target), "utf8"), {
    onNotice: (n) => console.log("  " + (n.message ?? n)),
  });
  const last = results[results.length - 1];
  if (last?.rows?.length) console.log("\nfinal result:", JSON.stringify(last.rows));
  console.log("\nOK");
} catch (err) {
  console.error("\nFAILED:", err.message);
  process.exitCode = 1;
} finally {
  await db.close();
}

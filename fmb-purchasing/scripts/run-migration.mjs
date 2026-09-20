#!/usr/bin/env node
/**
 * Apply one migration to one database, and record it in the ledger.
 *
 * Every migration has to be run in both projects — sandbox and live — and
 * until now that meant pasting SQL into two dashboards, which is how a
 * migration once went to the wrong one: the two look identical apart from the
 * project ref in the URL.
 *
 * So the guardrails here are about *which database* rather than about the SQL:
 *
 *   - the file must be a real migration in supabase/migrations,
 *   - the whole file runs in one transaction, so a failure leaves nothing
 *     half-applied,
 *   - a migration already in schema_migrations is refused,
 *   - the project ref is printed before anything runs, and live needs --live
 *     said out loud on the command line.
 *
 * Usage:
 *   node scripts/run-migration.mjs --env .env.sandbox 0063_something.sql
 *   node scripts/run-migration.mjs --env .env.local --live 0063_something.sql
 *   node scripts/run-migration.mjs --env .env.sandbox --pending     # list what's missing
 *
 * The connection string comes from SUPABASE_DB_URL in the env file given —
 * the **session pooler** URI from the Supabase dashboard, because the direct
 * host is IPv6-only and does not resolve from this machine.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

function parseArgs(argv) {
  const args = { env: ".env.sandbox", live: false, pending: false, file: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env") args.env = argv[++i];
    else if (arg === "--live") args.live = true;
    else if (arg === "--pending") args.pending = true;
    else if (!arg.startsWith("--")) args.file = arg;
  }
  return args;
}

function loadEnv(file) {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].trim().replace(/^"|"$/g, "");
  }
  return env;
}

/** postgres://postgres.<ref>:…@aws-…pooler.supabase.com:5432/postgres */
function projectRef(url) {
  const user = decodeURIComponent(new URL(url).username);
  return user.includes(".") ? user.split(".").slice(1).join(".") : user;
}

function withPassword(url, password) {
  if (!password) return url;
  const parsed = new URL(url);
  parsed.password = encodeURIComponent(password);
  return parsed.toString();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv(args.env);
  const url = env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      `${args.env} has no SUPABASE_DB_URL.\n` +
        "Copy the session pooler URI from the Supabase dashboard (Connect → Session pooler),\n" +
        "put the database password into it, and add it to that file."
    );
    process.exit(1);
  }

  // A password given on its own line wins over whatever is in the URI: a
  // database password routinely contains characters a URL treats specially,
  // and encoding them by hand is exactly the fiddle worth removing.
  const connectionString = withPassword(url, env.SUPABASE_DB_PASSWORD);

  const ref = projectRef(url);
  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    // What the database itself says it is, which is a better guard than the
    // name of the env file it came from.
    const { rows: kindRows } = await client.query("select kind from deployment_kind limit 1");
    const kind = kindRows[0]?.kind ?? "unknown";
    console.log(`Database: ${ref} (${kind}), from ${args.env}`);

    const { rows: done } = await client.query("select filename from schema_migrations order by filename");
    const applied = new Set(done.map((r) => r.filename));

    if (args.pending || !args.file) {
      const all = readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
      const pending = all.filter((f) => !applied.has(f));
      console.log(pending.length === 0 ? "Nothing pending." : `Pending:\n  ${pending.join("\n  ")}`);
      return;
    }

    const file = path.basename(args.file);
    if (!/^\d{4}_.*\.sql$/.test(file)) {
      throw new Error(`"${file}" is not a migration filename.`);
    }
    // The ledger first: a migration already applied here needs no file on
    // this branch, and saying so beats a missing-file error.
    if (applied.has(file)) {
      console.log(`${file} has already been run here. Nothing to do.`);
      return;
    }

    const filePath = path.join(MIGRATIONS, file);
    if (!existsSync(filePath)) {
      throw new Error(`No migration called ${file} in supabase/migrations.`);
    }
    const sql = readFileSync(filePath, "utf8");
    if (kind === "live" && !args.live) {
      throw new Error(`${ref} says it is live. Re-run with --live if that is what you mean.`);
    }

    console.log(`Applying ${file} (${sql.split(/\r?\n/).length} lines)…`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      throw err;
    }

    const { rows: after } = await client.query("select filename from schema_migrations where filename = $1", [file]);
    if (after.length === 0) {
      // Every migration from 0041 records itself; one that doesn't has been
      // applied but leaves the ledger wrong, which is worth saying loudly.
      console.warn(`Applied, but ${file} did not record itself in schema_migrations.`);
    } else {
      console.log(`Done. ${file} is recorded in schema_migrations.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

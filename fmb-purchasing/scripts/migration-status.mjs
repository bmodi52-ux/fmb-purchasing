/**
 * Which migrations a database still needs — see migration 0041.
 *
 *   node scripts/migration-status.mjs
 *   node scripts/migration-status.mjs --env .env.sandbox
 *
 * Reads schema_migrations through the service-role key in the given env file
 * (.env.local by default), compares it with supabase/migrations, and lists
 * what to paste into that project's SQL editor, in order. Reads only.
 *
 * A database without the ledger has not had 0041; everything from 0041 on is
 * listed as missing, since nothing earlier can be checked this way.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const envFlag = process.argv.indexOf("--env");
const envFile = envFlag > -1 ? process.argv[envFlag + 1] : ".env.local";

const env = {};
for (const line of readFileSync(new URL(`../${envFile}`, import.meta.url), "utf8").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim();
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(`${envFile} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`);
  process.exit(1);
}

const files = readdirSync(path.join(import.meta.dirname, "..", "supabase", "migrations"))
  .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f >= "0041")
  .sort();

const admin = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await admin.from("schema_migrations").select("filename, applied_at");

const project = new URL(url).hostname.split(".")[0];
console.log(`Project ${project}`);

let applied = new Map();
if (error) {
  if (error.code !== "42P01" && error.code !== "PGRST205") {
    console.error(`Could not read schema_migrations: ${error.message}`);
    process.exit(1);
  }
  console.log("No migration ledger yet — 0041 has not been run.");
} else {
  applied = new Map(data.map((r) => [r.filename, r.applied_at]));
}

const missing = files.filter((f) => !applied.has(f));
if (missing.length === 0) {
  console.log(`Up to date: all ${files.length} ledgered migrations applied.`);
} else {
  console.log(`Run these in the SQL editor, in this order:`);
  for (const f of missing) console.log(`  supabase/migrations/${f}`);
  process.exitCode = 2;
}

/**
 * A logical backup of everything the database holds, as JSON on disk.
 *
 *   node scripts/backup-data.mjs
 *   node scripts/backup-data.mjs --out "D:/fmb-backups"
 *
 * Supabase's own backups are the better tool and should be the first choice —
 * but point-in-time recovery is a Pro-plan feature, and on the free plan there
 * may be nothing scheduled at all. This needs no plan: it reads through the
 * service-role key, which is what the app already uses, and writes one file
 * per table plus the account list.
 *
 * WHAT IT SAVES
 *   Every row of every table in `public`, and the Auth user list (email,
 *   name, timestamps) via the admin API.
 *
 * WHAT IT DOES NOT SAVE, and why that is survivable
 *   * The schema — it is in supabase/migrations, which is the source of truth
 *     and is applied from scratch by the test suite on every run.
 *   * Receipt files — storage is not the database. Since 0028 objects are
 *     named by the SHA-256 of their contents, so re-uploading is idempotent;
 *     see docs/backup-and-restore.md.
 *   * Password hashes — the admin API does not expose them. A restore from
 *     this leaves accounts needing a password reset, which is recoverable;
 *     losing who the accounts *are* would not be.
 *
 * It is a consistent-enough snapshot, not a transactional one: tables are read
 * one after another, so a submission landing mid-run could appear in
 * expense_line_items and not in expenses. Run it when nobody is submitting, or
 * treat a torn row as the one thing to check on restore.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].trim();
  }
}
loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Every table in `public`, in dependency order so that a hand-restore can
 * simply replay the files top to bottom.
 */
/**
 * Used only when the database can't list its own tables (a project without
 * migration 0055). Otherwise every table in public is saved, so a table added
 * by a later migration is never quietly left out.
 */
const FALLBACK_TABLES = [
  "app_pages",
  "app_actions",
  "teams",
  "profiles",
  "team_members",
  "team_permissions",
  "categories",
  "units",
  // Note: canonical_item_groups is absent on purpose — 0007 renamed it to
  // `items`, so the old name is a table that no longer exists.
  "vendors",
  "vendor_collection_addresses",
  "vendor_contacts",
  "items",
  "item_pack_sizes",
  "item_number_aliases",
  "item_history",
  "item_duplicate_dismissals",
  "vendor_item_descriptions",
  "pricelist_items",
  "pricelist_item_history",
  "payees",
  "payment_runs",
  "expenses",
  "expense_line_items",
  "expense_attachments",
  "expense_status_history",
  "category_budgets",
  "notifications",
  "user_column_preferences",
  "user_dashboard_widgets",
  "extraction_attempts",
  "error_events",
  "signin_attempts",
  "password_reset_attempts",
];

/** PostgREST caps a response; page rather than silently truncating a table. */
const PAGE = 1000;

async function dumpTable(name) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(name).select("*").range(from, from + PAGE - 1);
    if (error) {
      // A table added by a migration that has not been applied to this project
      // is worth reporting, not worth aborting a backup over.
      return { name, rows: null, error: error.message };
    }
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return { name, rows, error: null };
}

async function dumpUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return { rows: null, error: error.message };
    users.push(
      ...data.users.map((u) => ({
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        email_confirmed_at: u.email_confirmed_at,
        user_metadata: u.user_metadata,
      }))
    );
    if (data.users.length < 200) break;
  }
  return { rows: users, error: null };
}

const outFlag = process.argv.indexOf("--out");
const baseDir =
  outFlag !== -1 && process.argv[outFlag + 1]
    ? process.argv[outFlag + 1]
    : path.join(process.env.USERPROFILE || process.env.HOME || ".", "fmb-backups");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = path.join(baseDir, stamp);
mkdirSync(dir, { recursive: true });

console.log(`Backing up ${new URL(url).host}`);
console.log(`  -> ${dir}\n`);

const startedAt = new Date().toISOString();
const summary = [];
let failed = 0;

const { data: listed, error: listError } = await admin.rpc("public_table_names");
const TABLES = !listError && Array.isArray(listed) && listed.length ? listed.map(String) : FALLBACK_TABLES;
if (listError) console.log(`  (listing tables failed: ${listError.message}; using the built-in list)\n`);

for (const table of TABLES) {
  const result = await dumpTable(table);
  if (result.error) {
    console.log(`  !! ${table.padEnd(30)} ${result.error}`);
    summary.push({ table, rows: null, error: result.error });
    failed++;
    continue;
  }
  writeFileSync(path.join(dir, `${table}.json`), JSON.stringify(result.rows, null, 2));
  console.log(`  ok ${table.padEnd(30)} ${String(result.rows.length).padStart(6)} rows`);
  summary.push({ table, rows: result.rows.length, error: null });
}

const users = await dumpUsers();
if (users.error) {
  console.log(`  !! ${"auth.users".padEnd(30)} ${users.error}`);
  failed++;
} else {
  writeFileSync(path.join(dir, "auth_users.json"), JSON.stringify(users.rows, null, 2));
  console.log(`  ok ${"auth.users".padEnd(30)} ${String(users.rows.length).padStart(6)} accounts`);
}

writeFileSync(
  path.join(dir, "MANIFEST.json"),
  JSON.stringify(
    {
      takenAt: new Date().toISOString(),
      project: new URL(url).host,
      tables: summary,
      authAccounts: users.rows?.length ?? null,
      notes:
        "Data only. Schema lives in supabase/migrations; receipt files live in the " +
        "receipts storage bucket and are NOT included; password hashes are not " +
        "exposed by the admin API, so restored accounts need a password reset.",
    },
    null,
    2
  )
);

const totalRows = summary.reduce((n, s) => n + (s.rows ?? 0), 0);
console.log(`\n${totalRows.toLocaleString()} rows written to ${dir}`);

// Recorded on Backups & records (#45), whether or not every table read.
const { error: recordError } = await admin.from("backup_runs").insert({
  kind: "database",
  started_at: startedAt,
  item_count: totalRows,
  problems: failed,
  destination: dir,
});
if (recordError) console.log(`(could not record this run in the app: ${recordError.message})`);
if (failed > 0) {
  console.log(`${failed} table(s) could not be read — see MANIFEST.json`);
  process.exit(1);
}

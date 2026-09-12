/**
 * Fills the sandbox with a scrubbed copy of the live data (scratchpad #1).
 *
 *   node --import ./scripts/test-setup.mjs scripts/seed-sandbox.mjs --dry-run
 *   node --import ./scripts/test-setup.mjs scripts/seed-sandbox.mjs
 *   node --import ./scripts/test-setup.mjs scripts/seed-sandbox.mjs --skip-files
 *
 * Reads live through .env.local and the sandbox through .env.sandbox, and
 * refuses to start unless the target database has been marked as the sandbox
 * (migration 0058) — so the worst a mixed-up key can do is stop.
 *
 * What the sandbox ends up with: every vendor, item, price, expense, budget
 * and notification from live, with vendor names, people, bank details,
 * addresses and email addresses replaced by invented ones that stay the same
 * at every reset. Real people are not copied at all — everything they did is
 * attributed to a trainee, so a trainee opens the app to their own work.
 *
 * Receipt files are copied as they are. Their contents are not scrubbed, which
 * was decided knowingly: the vendor and ABN printed on a receipt stay visible.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { TRAINEES } from "../src/lib/sandbox-trainees.ts";
import {
  buildTextScrubber,
  scrubDeep,
  scrubbedAbn,
  scrubbedAccountNumber,
  scrubbedAddress,
  scrubbedBsb,
  scrubbedEmail,
  scrubbedPersonName,
  scrubbedPhone,
  scrubbedVendorName,
  withoutGeneratedColumns,
} from "../src/lib/sandbox-scrub.ts";

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_FILES = process.argv.includes("--skip-files");
const BUCKET = "receipts";
const PAGE = 1000;
const CHUNK = 500;

function readEnv(file) {
  const env = {};
  for (const line of readFileSync(new URL("../" + file, import.meta.url), "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

/** Copied in this order, so a row never lands before the row it points at. */
const TABLE_ORDER = [
  "teams", "team_permissions",
  "categories", "units",
  "vendors", "vendor_contacts", "vendor_collection_addresses", "vendor_item_descriptions", "vendor_changes",
  "items", "item_number_aliases", "item_pack_sizes", "item_history", "item_duplicate_dismissals",
  "pricelist_items", "pricelist_item_history",
  "payees", "payment_runs",
  "expenses", "expense_line_items", "expense_attachments", "expense_status_history",
  "category_budgets", "category_budget_phasing", "category_budget_changes", "locked_periods",
  "saved_report_views", "saved_report_view_teams",
  "alert_rules", "announcements", "notifications", "team_notification_defaults",
  "access_changes", "app_settings",
];

/**
 * Left out on purpose: the registry tables the migrations own, one person's
 * devices and preferences, and the logs a sandbox should start clean.
 */
const SKIP_TABLES = new Set([
  "app_pages", "app_actions", "schema_migrations", "deployment_kind",
  "profiles", "team_members", "stand_ins",
  "push_subscriptions", "notification_preferences", "user_column_preferences", "user_dashboard_widgets",
  "scheduled_runs", "extraction_attempts", "signin_attempts", "password_reset_attempts", "error_events",
  "extraction_benchmark_cases", "extraction_benchmark_runs", "extraction_benchmark_results",
  "backup_runs", "restore_rehearsals", "inbound_receipts",
  "price_alert_firings", "budget_alert_firings", "alert_rule_firings",
]);

/** Columns that hold a person. Anything found here is pointed at a trainee. */
const PERSON_COLUMNS = new Set(["user_id", "actor_id", "owner_id", "profile_id", "stand_in_id", "subject_id"]);
const isPersonColumn = (name) => PERSON_COLUMNS.has(name) || name.endsWith("_by");

async function allRows(client, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select("*").range(from, from + PAGE - 1);
    if (error) return { rows: null, error: error.message };
    rows.push(...data);
    if (data.length < PAGE) return { rows, error: null };
  }
}

const live = readEnv(".env.local");
const sandboxEnv = readEnv(".env.sandbox");
for (const [name, env] of [[".env.local", live], [".env.sandbox", sandboxEnv]]) {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(name + " needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
}
if (live.NEXT_PUBLIC_SUPABASE_URL === sandboxEnv.NEXT_PUBLIC_SUPABASE_URL) {
  console.error("Refusing to run: .env.sandbox points at the same project as .env.local");
  process.exit(1);
}

const from = createClient(live.NEXT_PUBLIC_SUPABASE_URL, live.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const to = createClient(sandboxEnv.NEXT_PUBLIC_SUPABASE_URL, sandboxEnv.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log("From: " + new URL(live.NEXT_PUBLIC_SUPABASE_URL).host);
console.log("To:   " + new URL(sandboxEnv.NEXT_PUBLIC_SUPABASE_URL).host + (DRY_RUN ? "  (dry run)" : ""));

const marked = await to.from("deployment_kind").select("kind").maybeSingle();
if (marked.error || marked.data?.kind !== "sandbox") {
  console.error("Refusing to run: the target database is not marked as the sandbox.");
  console.error("Run this there once, after the migrations, then try again:");
  console.error("  update deployment_kind set kind = 'sandbox', marked_at = now();");
  process.exit(1);
}

/* ------------------------------------------------------- read and scrub */

const source = {};
let unreadable = 0;
for (const table of TABLE_ORDER) {
  const result = await allRows(from, table);
  if (result.error) {
    console.log("  !! " + table.padEnd(30) + result.error);
    unreadable++;
    continue;
  }
  source[table] = result.rows;
}

const listed = await from.rpc("public_table_names");
const missed = (listed.data || []).filter((t) => !TABLE_ORDER.includes(t) && !SKIP_TABLES.has(t));
if (missed.length > 0) console.log("  note: neither copied nor skipped, so left empty: " + missed.join(", "));

const people = (await allRows(from, "profiles")).rows || [];
const vendorName = new Map((source.vendors || []).map((v) => [v.id, scrubbedVendorName(v.id)]));
const personName = new Map(people.map((p) => [p.id, scrubbedPersonName(p.id)]));

// Every real name, so it is rewritten wherever it appears in free text too.
const replacements = [];
for (const v of source.vendors || []) if (v.name) replacements.push({ from: v.name, to: vendorName.get(v.id) });
for (const p of people) {
  if (p.full_name) replacements.push({ from: p.full_name, to: personName.get(p.id) });
  if (p.email) replacements.push({ from: p.email, to: scrubbedEmail(p.id, personName.get(p.id)) });
}
for (const p of source.payees || []) {
  if (p.display_name && !p.vendor_id) replacements.push({ from: p.display_name, to: scrubbedPersonName(p.id) });
}
const scrubText = buildTextScrubber(replacements);

function scrubRow(table, row, userMap) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const isPerson = isPersonColumn(key) && typeof value === "string" && userMap.has(value);
    out[key] = isPerson ? userMap.get(value) : scrubDeep(value, scrubText);
  }

  if (table === "vendors") {
    out.name = vendorName.get(row.id);
    if (row.abn) out.abn = scrubbedAbn(row.id);
    if (row.billing_address) out.billing_address = scrubbedAddress(row.id);
  }
  if (table === "vendor_contacts") {
    out.name = scrubbedPersonName(row.id);
    if (row.phone) out.phone = scrubbedPhone(row.id);
  }
  if (table === "vendor_collection_addresses") {
    const address = scrubbedAddress(row.id);
    out.line1 = address.line1;
    out.line2 = null;
    out.suburb = address.suburb;
    out.postcode = address.postcode;
  }
  if (table === "payees") {
    const name = (row.vendor_id ? vendorName.get(row.vendor_id) : null) || scrubbedPersonName(row.id);
    out.display_name = name;
    if (row.bank_account_name) out.bank_account_name = name.toUpperCase();
    if (row.bank_bsb) out.bank_bsb = scrubbedBsb(row.id);
    if (row.bank_account_number) out.bank_account_number = scrubbedAccountNumber(row.id);
    if (row.remittance_email) out.remittance_email = scrubbedEmail(row.id, name);
    out.notes = null;
  }
  if (table === "expenses" && row.vendor_id && vendorName.has(row.vendor_id)) {
    out.vendor_name_raw = vendorName.get(row.vendor_id);
  }
  if (table === "app_settings" && row.key === "aba") {
    out.value = {
      ...(row.value || {}),
      bsb: "999000",
      accountNumber: "00000000",
      userName: "FMB SANDBOX",
      remitterName: "FMB SANDBOX",
    };
  }
  return withoutGeneratedColumns(table, out);
}

const rowCount = TABLE_ORDER.reduce((n, t) => n + (source[t]?.length || 0), 0);
console.log("Read " + rowCount.toLocaleString() + " rows from live, across " + TABLE_ORDER.length + " tables.");
if (unreadable > 0) console.log(unreadable + " table(s) could not be read.");

/* -------------------------------------------------------------- trainees */

const existing = await to.auth.admin.listUsers({ page: 1, perPage: 200 });
if (existing.error) {
  console.error("Could not list the sandbox logins: " + existing.error.message);
  process.exit(1);
}
const wanted = new Map(TRAINEES.map((t) => [t.email.toLowerCase(), t]));
const keep = existing.data.users.filter((u) => wanted.has((u.email || "").toLowerCase()));
const drop = existing.data.users.filter((u) => !wanted.has((u.email || "").toLowerCase()));
const missing = TRAINEES.filter((t) => !keep.some((u) => (u.email || "").toLowerCase() === t.email.toLowerCase()));

console.log(
  "Trainees: " + keep.length + " kept, " + missing.length + " to create, " + drop.length + " other login(s) to remove."
);

if (DRY_RUN) {
  console.log("Dry run: nothing was changed.");
  process.exit(0);
}

const reset = await to.rpc("sandbox_reset");
if (reset.error) {
  console.error("The sandbox could not be emptied: " + reset.error.message);
  process.exit(1);
}
console.log("Sandbox emptied.");

for (const user of drop) await to.auth.admin.deleteUser(user.id);

const traineeIds = [];
for (const trainee of TRAINEES) {
  const already = keep.find((u) => (u.email || "").toLowerCase() === trainee.email.toLowerCase());
  if (already) {
    // The reset took their profile with everything else; put it back, so the
    // login they already have keeps working with the password they already set.
    const { error } = await to
      .from("profiles")
      .insert({ id: already.id, full_name: trainee.name, email: trainee.email, is_active: true });
    if (error) console.log("  !! profile for " + trainee.email + ": " + error.message);
    traineeIds.push(already.id);
    continue;
  }
  const password = "Sandbox-" + Math.random().toString(36).slice(2, 10);
  const created = await to.auth.admin.createUser({
    email: trainee.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: trainee.name, contact_email: trainee.email },
  });
  if (created.error || !created.data.user) {
    console.log("  !! could not create " + trainee.email + ": " + (created.error?.message || "no user"));
    continue;
  }
  traineeIds.push(created.data.user.id);
  console.log("  created " + trainee.email + " with password " + password + "  (change it after signing in)");
}

if (traineeIds.length === 0) {
  console.error("No trainee logins, so nothing could sign in. Check src/lib/sandbox-trainees.ts.");
  process.exit(1);
}

// Everything a real person did is attributed to a trainee, in a fixed order,
// so the same person is the same trainee at every reset.
const userMap = new Map();
people
  .map((p) => p.id)
  .sort()
  .forEach((id, index) => userMap.set(id, traineeIds[index % traineeIds.length]));

/* ------------------------------------------------------------- write it */

let written = 0;
for (const table of TABLE_ORDER) {
  const rows = source[table];
  if (!rows || rows.length === 0) continue;
  const scrubbed = rows.map((row) => scrubRow(table, row, userMap));
  for (let i = 0; i < scrubbed.length; i += CHUNK) {
    const slice = scrubbed.slice(i, i + CHUNK);
    const { error } = await to.from(table).insert(slice);
    if (error) {
      console.log("  !! " + table + " (rows " + i + " to " + (i + slice.length) + "): " + error.message);
      break;
    }
    written += slice.length;
  }
  console.log("  " + table.padEnd(30) + String(rows.length).padStart(6) + " rows");
}

// The numbering sequences now sit past everything just written.
const synced = await to.rpc("sandbox_sync_sequences");
if (synced.error) console.log("  !! sequences: " + synced.error.message);

// Trainees join the teams they are listed under.
const teamsByName = new Map((source.teams || []).map((t) => [t.name.toLowerCase(), t.id]));
for (const [index, trainee] of TRAINEES.entries()) {
  const userId = traineeIds[index % traineeIds.length];
  for (const teamName of trainee.teams) {
    const teamId = teamsByName.get(teamName.toLowerCase());
    if (!teamId) {
      console.log("  !! " + trainee.email + ": no team called " + teamName);
      continue;
    }
    const { error } = await to.from("team_members").insert({ team_id: teamId, user_id: userId });
    if (error && error.code !== "23505") console.log("  !! team for " + trainee.email + ": " + error.message);
  }
}

/* ------------------------------------------------------------ the files */

let files = 0;
if (!SKIP_FILES) {
  const walk = async (prefix) => {
    const found = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await from.storage.from(BUCKET).list(prefix, { limit: PAGE, offset });
      if (error) throw new Error(error.message);
      for (const entry of data || []) {
        const path = prefix ? prefix + "/" + entry.name : entry.name;
        if (entry.id === null) found.push(...(await walk(path)));
        else found.push(path);
      }
      if ((data || []).length < PAGE) return found;
    }
  };

  const paths = await walk("");
  console.log("Copying " + paths.length + " receipt file(s)...");
  for (const path of paths) {
    const file = await from.storage.from(BUCKET).download(path);
    if (file.error || !file.data) {
      console.log("  !! " + path + ": " + (file.error?.message || "no data"));
      continue;
    }
    const bytes = Buffer.from(await file.data.arrayBuffer());
    const put = await to.storage.from(BUCKET).upload(path, bytes, { contentType: file.data.type, upsert: true });
    if (put.error) console.log("  !! " + path + ": " + put.error.message);
    else files++;
    if (files > 0 && files % 50 === 0) console.log("  " + files + " copied...");
  }
}

console.log("");
console.log("Done: " + written.toLocaleString() + " rows and " + files + " file(s) in the sandbox.");
console.log("Trainees sign in at https://sandbox.fmbpurchasing.com.au");

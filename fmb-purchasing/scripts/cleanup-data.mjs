/**
 * One-off cleanup companion to
 * supabase/maintenance/2026-09-05_reset-operational-data.sql.
 *
 * Two jobs the SQL cannot do:
 *   1. Report what is about to be destroyed, so the counts can be eyeballed
 *      before anything is truncated.
 *   2. Empty the `receipts` storage bucket. Storage lives outside Postgres,
 *      so truncating `expenses` orphans every uploaded file.
 *
 * Usage:
 *   node scripts/cleanup-data.mjs                 # report only, changes nothing
 *   node scripts/cleanup-data.mjs --empty-bucket  # also deletes every receipt file
 *
 * The default is deliberately read-only — running this script by accident
 * must never destroy anything. Deletion requires the explicit flag.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnvLocal() {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2];
  }
}
loadEnvLocal();

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Mirrors the truncate list in the SQL, in the same order.
const CLEARED = [
  "expense_status_history",
  "expense_line_items",
  "expenses",
  "notifications",
  "error_events",
  "vendor_item_descriptions",
  "item_duplicate_dismissals",
  "item_history",
  "pricelist_item_history",
  "pricelist_items",
  "item_pack_sizes",
  "items",
  "vendor_contacts",
  "vendor_collection_addresses",
  "vendors",
  "user_column_preferences",
  "user_dashboard_widgets",
  "password_reset_attempts",
];

const KEPT = [
  "profiles",
  "teams",
  "team_members",
  "app_pages",
  "app_actions",
  "team_permissions",
  "categories",
  "units",
];

async function countRows(table) {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
  return error ? `error: ${error.message}` : count;
}

async function report(label, tables) {
  console.log(`\n${label}`);
  for (const table of tables) {
    console.log(`  ${table.padEnd(30)} ${await countRows(table)}`);
  }
}

/** Receipt paths are `<userId>/<timestamp>-<name>`, so one level of folders. */
async function listReceiptPaths() {
  const paths = [];
  const { data: folders, error } = await admin.storage.from("receipts").list("", { limit: 1000 });
  if (error) throw new Error(`Could not list the receipts bucket: ${error.message}`);

  for (const folder of folders ?? []) {
    // a real file at the root has an id; a folder placeholder does not
    if (folder.id) {
      paths.push(folder.name);
      continue;
    }
    const { data: files } = await admin.storage.from("receipts").list(folder.name, { limit: 1000 });
    for (const file of files ?? []) {
      if (file.id) paths.push(`${folder.name}/${file.name}`);
    }
  }
  return paths;
}

const emptyBucket = process.argv.includes("--empty-bucket");

await report("Will be cleared by the SQL:", CLEARED);
await report("Kept:", KEPT);

const receiptPaths = await listReceiptPaths();
console.log(`\nreceipts bucket: ${receiptPaths.length} file(s)`);

if (!emptyBucket) {
  console.log("\nReport only — nothing was changed.");
  console.log("Run the SQL in supabase/maintenance/ to clear the tables,");
  console.log("and re-run this with --empty-bucket to delete the receipt files.");
} else if (receiptPaths.length === 0) {
  console.log("\nBucket is already empty.");
} else {
  // remove() caps at 1000 paths per call
  for (let i = 0; i < receiptPaths.length; i += 1000) {
    const batch = receiptPaths.slice(i, i + 1000);
    const { error } = await admin.storage.from("receipts").remove(batch);
    if (error) throw new Error(`Delete failed at offset ${i}: ${error.message}`);
    console.log(`  deleted ${batch.length} file(s)`);
  }
  console.log(`\nDeleted ${receiptPaths.length} receipt file(s).`);
}

/**
 * A copy of every receipt file, kept on this machine (#45).
 *
 *   node scripts/backup-receipts.mjs
 *   node scripts/backup-receipts.mjs --out "G:/My Drive/FMB Backups/receipts"
 *
 * Supabase's database backups don't include Storage, so without this the
 * receipts are the one record that exists in a single place. The copy mirrors
 * the bucket's own paths. It is incremental: a file already copied at the
 * same size is skipped, and since receipts are named by the SHA-256 of their
 * contents, a file of that name never changes. Nothing is ever deleted from
 * the copy.
 *
 * Each run is recorded on Backups & records in the app. Schedule it — see
 * docs/backup-and-restore.md for a Windows Task Scheduler line.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) process.env[match[1]] ??= match[2].trim();
    }
  } catch {
    // The environment may already be set.
  }
}
loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const BUCKET = "receipts";
const outFlag = process.argv.indexOf("--out");
const OUT =
  outFlag !== -1 && process.argv[outFlag + 1]
    ? process.argv[outFlag + 1]
    : path.join(process.env.USERPROFILE || process.env.HOME || ".", "fmb-backups", "receipts");

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const PAGE = 1000;

/** Every file under a folder of the bucket, walking into sub-folders. */
async function listAll(prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .list(prefix, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`Listing ${prefix || "the bucket"}: ${error.message}`);
    for (const entry of data ?? []) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Folders come back without an id.
      if (entry.id === null) files.push(...(await listAll(full)));
      else files.push({ path: full, size: Number(entry.metadata?.size ?? 0) });
    }
    if ((data ?? []).length < PAGE) return files;
  }
}

const startedAt = new Date().toISOString();
console.log(`Backing up receipt files from ${new URL(url).host}`);
console.log(`  -> ${OUT}\n`);
mkdirSync(OUT, { recursive: true });

let files;
try {
  files = await listAll();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

let copied = 0;
let bytes = 0;
let problems = 0;
for (const file of files) {
  const target = path.join(OUT, ...file.path.split("/"));
  if (existsSync(target) && (!file.size || statSync(target).size === file.size)) {
    bytes += file.size;
    continue;
  }
  const { data, error } = await admin.storage.from(BUCKET).download(file.path);
  if (error || !data) {
    console.log(`  !! ${file.path}: ${error?.message ?? "no data"}`);
    problems++;
    continue;
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, buffer);
  copied++;
  bytes += buffer.byteLength;
  if (copied % 50 === 0) console.log(`  ${copied} copied…`);
}

console.log(`\n${files.length} files in the bucket, ${copied} newly copied, ${problems} problems.`);

const { error: recordError } = await admin.from("backup_runs").insert({
  kind: "receipt_files",
  started_at: startedAt,
  item_count: files.length,
  new_count: copied,
  bytes,
  problems,
  destination: OUT,
});
if (recordError) console.log(`(could not record this run in the app: ${recordError.message})`);
if (problems > 0) process.exit(1);

/**
 * Loads the confirmed receipts into the app's scheduled reading check (#49).
 *
 *   node --import ./scripts/test-setup.mjs scripts/load-extraction-check.mjs --dry-run
 *   node --import ./scripts/test-setup.mjs scripts/load-extraction-check.mjs --dir "G:/My Drive/FMB Receipts"
 *
 * Every entry in scripts/extraction-ground-truth.json that states at least one
 * scored field, and whose file is in the folder, is uploaded to the receipts
 * bucket (content-addressed, like any upload) and recorded with its confirmed
 * values. Running it again updates the values of receipts already loaded, so
 * correcting the JSON and re-running is how the check learns a correction.
 * Entries removed from the JSON are switched off, not deleted, so past runs
 * keep their results.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { hasScoredFields } from "../src/lib/extraction-scoring.ts";
import { RECEIPTS_BUCKET, receiptStoragePath, sha256Hex } from "../src/lib/receipt-storage.ts";

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

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const DIR = arg("dir", "G:/My Drive/FMB Receipts");
const DRY_RUN = process.argv.includes("--dry-run");

const MEDIA_TYPES = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".eml": "message/rfc822",
};

const truth = JSON.parse(readFileSync(new URL("./extraction-ground-truth.json", import.meta.url), "utf8"));
delete truth._readme;

const entries = Object.entries(truth).filter(([, expected]) => hasScoredFields(expected));
console.log(`${entries.length} confirmed ${entries.length === 1 ? "receipt" : "receipts"} with scored fields.`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY_RUN && (!url || !key)) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const admin = DRY_RUN ? null : createClient(url, key, { auth: { persistSession: false } });

const loaded = [];
for (const [fileName, expected] of entries) {
  const file = path.join(DIR, fileName);
  const contentType = MEDIA_TYPES[path.extname(fileName).toLowerCase()];
  if (!existsSync(file) || !contentType) {
    console.warn(`  skipped ${fileName}: ${contentType ? "not in the folder" : "not a receipt type"}`);
    continue;
  }
  const bytes = new Uint8Array(readFileSync(file));
  const sha256 = sha256Hex(bytes);
  const storagePath = receiptStoragePath(sha256, contentType);
  const scored = Object.fromEntries(Object.entries(expected).filter(([field]) => field !== "notes"));

  if (DRY_RUN) {
    console.log(`  would load ${fileName} (${Object.keys(scored).join(", ")})`);
    loaded.push(sha256);
    continue;
  }

  const { error: uploadError } = await admin.storage
    .from(RECEIPTS_BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: true });
  if (uploadError) {
    console.error(`  failed ${fileName}: ${uploadError.message}`);
    continue;
  }
  const { error } = await admin.from("extraction_benchmark_cases").upsert(
    { file_name: fileName, storage_path: storagePath, content_type: contentType, sha256, expected: scored, active: true },
    { onConflict: "sha256" }
  );
  if (error) {
    console.error(`  failed ${fileName}: ${error.message}`);
    continue;
  }
  console.log(`  loaded ${fileName}`);
  loaded.push(sha256);
}

if (!DRY_RUN && loaded.length) {
  const { data: existing } = await admin.from("extraction_benchmark_cases").select("sha256").eq("active", true);
  const gone = (existing ?? []).map((r) => r.sha256).filter((s) => !loaded.includes(s));
  if (gone.length) {
    await admin.from("extraction_benchmark_cases").update({ active: false }).in("sha256", gone);
    console.log(`Switched off ${gone.length} no longer in the file.`);
  }
}
console.log(DRY_RUN ? "Dry run: nothing was changed." : `Done: ${loaded.length} loaded.`);

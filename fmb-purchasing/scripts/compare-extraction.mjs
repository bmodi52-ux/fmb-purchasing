/**
 * Run a folder of real receipts through one or more models and report what
 * each got right, what they disagree about, and what it actually cost.
 *
 * The point is to settle model and effort choices with measurement instead of
 * argument. Everything about this task pulls in opposite directions —
 * Sonnet 5 sees at higher resolution, Opus 5 reasons harder, and once the
 * image is priced they cost about the same — so the only useful input is what
 * they each do on these receipts, which are faded, sideways, annotated in pen
 * and mostly GST-free.
 *
 * It imports the app's own extractReceiptDetailed, so it exercises the real
 * prompt and the real tool schema. A harness with its own copy of the prompt
 * measures something the app does not do.
 *
 * THIS SPENDS MONEY. Every file is one API call per model. Run --dry-run
 * first: it prints the plan and an estimate without calling anything.
 *
 * Usage
 *   node --import ./scripts/test-setup.mjs scripts/compare-extraction.mjs --dry-run
 *   node --import ./scripts/test-setup.mjs scripts/compare-extraction.mjs \
 *     --dir "G:/My Drive/FMB Receipts" \
 *     --models claude-sonnet-5,claude-opus-5 \
 *     --effort medium --concurrency 3
 *
 * Flags
 *   --dir <path>          folder of receipts        (default: G:/My Drive/FMB Receipts)
 *   --models a,b          models to compare         (default: claude-sonnet-5,claude-opus-5)
 *   --effort low|medium|high|xhigh|max              (default: medium)
 *   --limit <n>           only the first n files    (default: all)
 *   --concurrency <n>     parallel calls            (default: 3)
 *   --out <dir>           where results are written (default: ./extraction-runs)
 *   --dry-run             plan and estimate only, no API calls
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { extractReceiptDetailed } from "../src/lib/receipt-extraction.ts";
import { leafCategories } from "../src/lib/categories.ts";

/* ------------------------------------------------------------------ setup */

function loadEnvLocal() {
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) process.env[match[1]] ??= match[2].trim();
    }
  } catch {
    // Running with the environment already populated is fine.
  }
}
loadEnvLocal();

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const DIR = arg("dir", "G:/My Drive/FMB Receipts");
const MODELS = arg("models", "claude-sonnet-5,claude-opus-5").split(",").map((m) => m.trim());
const EFFORT = arg("effort", "medium");
const LIMIT = Number(arg("limit", "0")) || Infinity;
const CONCURRENCY = Number(arg("concurrency", "3"));
const OUT_DIR = arg("out", "./extraction-runs");
const DRY_RUN = flag("dry-run");

/**
 * First-party API rates, USD per million tokens. Cache reads are a tenth of
 * the input rate and cache writes a quarter more than it; neither should fire
 * here (nothing sets cache_control), but they are priced so that a surprise
 * shows up in the total rather than being silently dropped.
 */
const PRICING = {
  "claude-opus-5": { in: 5.0, out: 25.0 },
  "claude-sonnet-5": { in: 2.0, out: 10.0 },
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
};

const MEDIA_TYPES = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** Seed list from 0004/scripts/seed-categories.mjs, used when the database is unreachable. */
const FALLBACK_CATEGORIES = [
  "Groceries & Provisions", "Meat & Poultry", "Produce (Fruit & Vegetables)",
  "Dairy & Eggs", "Bakery", "Beverages", "Disposables & Packaging",
  "Cleaning & Sanitation", "Kitchen Equipment & Utensils", "Gas & Fuel",
  "Maintenance & Repairs", "Events & Venue", "Transport & Logistics",
  "Stationery & Printing", "Professional & Contractor Services", "Miscellaneous",
];

/* ------------------------------------------------------- inputs and truth */

async function loadCategories() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { names: FALLBACK_CATEGORIES, source: "fallback list (no Supabase env)" };

  try {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await admin.from("categories").select("id, name, parent_category_id").order("sort_order");
    if (!data?.length) return { names: FALLBACK_CATEGORIES, source: "fallback list (no rows)" };
    return { names: leafCategories(data).map((c) => c.name), source: "database" };
  } catch (err) {
    return { names: FALLBACK_CATEGORIES, source: `fallback list (${err.message})` };
  }
}

function loadGroundTruth() {
  const file = new URL("./extraction-ground-truth.json", import.meta.url);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    delete parsed._readme;
    return parsed;
  } catch {
    return {};
  }
}

function receiptFiles() {
  return readdirSync(DIR)
    .filter((f) => MEDIA_TYPES[path.extname(f).toLowerCase()])
    // "Foo (2).pdf" beside "Foo.pdf" is the same receipt saved twice.
    .filter((f) => !/\(\d+\)\./.test(f))
    .sort()
    .slice(0, LIMIT);
}

/* --------------------------------------------------------------- scoring */

const digits = (v) => String(v ?? "").replace(/\D/g, "");
const money = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);

/**
 * Compares one extraction against whatever the ground truth actually states.
 * Fields absent from the truth entry are not scored — an entry can assert the
 * three things someone verified without pretending to know the rest.
 */
function score(receipt, truth) {
  if (!truth) return null;
  const checks = [];
  const add = (field, ok, got, want) => checks.push({ field, ok, got, want });
  const text = (a, b) => String(a ?? "").toLowerCase().includes(String(b).toLowerCase());

  if (truth.vendor !== undefined) add("vendor", text(receipt.vendor, truth.vendor), receipt.vendor, truth.vendor);
  if (truth.abn !== undefined) add("abn", digits(receipt.abn) === digits(truth.abn), receipt.abn, truth.abn);
  if (truth.invoiceNumber !== undefined)
    add("invoiceNumber", text(receipt.invoiceNumber, truth.invoiceNumber), receipt.invoiceNumber, truth.invoiceNumber);
  if (truth.date !== undefined) add("date", text(receipt.date, truth.date), receipt.date, truth.date);
  if (truth.subtotal !== undefined) add("subtotal", money(receipt.subtotal) === money(truth.subtotal), receipt.subtotal, truth.subtotal);
  if (truth.gstAmount !== undefined) add("gstAmount", money(receipt.gstAmount) === money(truth.gstAmount), receipt.gstAmount, truth.gstAmount);
  if (truth.total !== undefined) add("total", money(receipt.total) === money(truth.total), receipt.total, truth.total);
  if (truth.lineCount !== undefined) add("lineCount", receipt.lineItems.length === truth.lineCount, receipt.lineItems.length, truth.lineCount);
  if (truth.payeeName !== undefined) add("payeeName", text(receipt.payee?.name, truth.payeeName), receipt.payee?.name ?? null, truth.payeeName);

  return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length };
}

/**
 * Whether the line items account for the recorded total — the invariant
 * migration 0026 introduced. A model that reads a surcharge but omits it from
 * the lines fails here even when every other field is right.
 */
function reconciles(receipt) {
  if (receipt.total == null) return null;
  const sum = receipt.lineItems.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
  return Math.abs(sum - receipt.total) <= 0.01;
}

function costOf(model, usage) {
  const rate = PRICING[model];
  if (!rate) return null;
  return (
    (usage.inputTokens * rate.in +
      usage.cacheReadTokens * rate.in * 0.1 +
      usage.cacheWriteTokens * rate.in * 1.25 +
      usage.outputTokens * rate.out) /
    1_000_000
  );
}

/* ------------------------------------------------------------------- run */

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}

const usd = (n) => (n == null ? "—" : `$${n.toFixed(4)}`);
const pad = (s, n) => String(s).padEnd(n);

async function main() {
  const files = receiptFiles();
  if (files.length === 0) {
    console.error(`No receipts found in ${DIR}`);
    process.exit(1);
  }

  const { names: categories, source: categorySource } = await loadCategories();
  const truth = loadGroundTruth();
  const scored = files.filter((f) => truth[f]).length;

  console.log(`\nReceipts   ${files.length} from ${DIR}`);
  console.log(`Models     ${MODELS.join(", ")}  (effort: ${EFFORT})`);
  console.log(`Categories ${categories.length}, from ${categorySource}`);
  console.log(`Truth      ${scored} of ${files.length} files have known-correct values`);
  console.log(`Calls      ${files.length * MODELS.length}`);

  if (DRY_RUN) {
    // ~2,950 input and ~225 output tokens per receipt, measured across this
    // same folder. Thinking tokens are billed as output and are not in this,
    // so treat it as a floor rather than a forecast.
    const est = MODELS.map((m) => {
      const rate = PRICING[m];
      const per = rate ? (2950 * rate.in + 225 * rate.out) / 1_000_000 : null;
      return `${m}: ${per == null ? "unknown rate" : `~${usd(per * files.length)}`}`;
    });
    console.log(`\nEstimated floor cost — ${est.join("   ")}`);
    console.log("Adaptive thinking will push the real figure above this.\n");
    console.log("Dry run: nothing was sent. Drop --dry-run to execute.\n");
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }

  console.log("\nRunning…\n");

  const rows = await mapWithConcurrency(files, CONCURRENCY, async (file) => {
    const bytes = readFileSync(path.join(DIR, file));
    const mediaType = MEDIA_TYPES[path.extname(file).toLowerCase()];
    const base64 = bytes.toString("base64");

    const byModel = {};
    for (const model of MODELS) {
      try {
        const detail = await extractReceiptDetailed(base64, mediaType, categories, {
          model,
          effort: EFFORT,
        });
        byModel[model] = {
          ok: true,
          receipt: detail.receipt,
          usage: detail.usage,
          stopReason: detail.stopReason,
          elapsedMs: detail.elapsedMs,
          cost: costOf(model, detail.usage),
          score: score(detail.receipt, truth[file]),
          reconciles: reconciles(detail.receipt),
        };
      } catch (err) {
        byModel[model] = { ok: false, error: err.message };
      }
      process.stdout.write(".");
    }
    return { file, sizeBytes: bytes.length, mediaType, byModel };
  });

  console.log("\n");
  report(rows, truth);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(OUT_DIR, `run-${stamp}.json`);
  writeFileSync(
    outFile,
    JSON.stringify({ dir: DIR, models: MODELS, effort: EFFORT, ranAt: stamp, rows }, null, 2)
  );
  console.log(`Full extractions written to ${outFile}\n`);
}

/* ---------------------------------------------------------------- report */

function report(rows, truth) {
  const nameWidth = Math.min(46, Math.max(...rows.map((r) => r.file.length)));

  console.log("PER RECEIPT".padEnd(nameWidth + 2) + MODELS.map((m) => pad(m.replace("claude-", ""), 26)).join(""));
  console.log("-".repeat(nameWidth + 2 + MODELS.length * 26));

  for (const row of rows) {
    const cells = MODELS.map((m) => {
      const r = row.byModel[m];
      if (!r?.ok) return pad(`FAILED: ${(r?.error ?? "").slice(0, 16)}`, 26);
      const s = r.score ? `${r.score.passed}/${r.score.total}` : "  —";
      const rec = r.reconciles === null ? "?" : r.reconciles ? "=" : "!";
      return pad(`${s} ${rec}  ${usd(r.cost)}  ${(r.elapsedMs / 1000).toFixed(1)}s`, 26);
    });
    console.log(pad(row.file.slice(0, nameWidth), nameWidth + 2) + cells.join(""));
  }

  console.log(
    `\n  score = ground-truth fields correct   ` +
      `= lines sum to total   ! they do not   ? no total read\n`
  );

  console.log("TOTALS");
  console.log("-".repeat(nameWidth + 2 + MODELS.length * 26));
  for (const model of MODELS) {
    const ok = rows.filter((r) => r.byModel[model]?.ok);
    const failed = rows.length - ok.length;
    const passed = ok.reduce((s, r) => s + (r.byModel[model].score?.passed ?? 0), 0);
    const checks = ok.reduce((s, r) => s + (r.byModel[model].score?.total ?? 0), 0);
    const balanced = ok.filter((r) => r.byModel[model].reconciles === true).length;
    const cost = ok.reduce((s, r) => s + (r.byModel[model].cost ?? 0), 0);
    const secs = ok.reduce((s, r) => s + r.byModel[model].elapsedMs, 0) / 1000;

    console.log(
      `  ${pad(model, 20)} ` +
        `accuracy ${passed}/${checks}${checks ? ` (${Math.round((passed / checks) * 100)}%)` : ""}   ` +
        `reconciled ${balanced}/${ok.length}   ` +
        `failed ${failed}   ` +
        `cost ${usd(cost)}   ` +
        `${(secs / Math.max(ok.length, 1)).toFixed(1)}s avg`
    );
    if (cost > 0) {
      console.log(`  ${pad("", 20)} extrapolated to 820 extractions/month: $${((cost / Math.max(ok.length, 1)) * 820).toFixed(2)}`);
    }
  }

  /* Every specific field a model got wrong, so a failure is actionable. */
  const misses = [];
  for (const row of rows) {
    for (const model of MODELS) {
      const r = row.byModel[model];
      if (!r?.ok || !r.score) continue;
      for (const c of r.score.checks) {
        if (!c.ok) misses.push(`  ${pad(row.file.slice(0, 40), 42)} ${pad(model.replace("claude-", ""), 12)} ${pad(c.field, 14)} got ${JSON.stringify(c.got)}  want ${JSON.stringify(c.want)}`);
      }
    }
  }
  if (misses.length) {
    console.log("\nWRONG FIELDS");
    console.log("-".repeat(nameWidth + 2 + MODELS.length * 26));
    misses.forEach((m) => console.log(m));
  }

  /*
   * Where the models disagree on a file with no ground truth. These are the
   * files worth checking against the paper next — a disagreement means at
   * least one model is wrong, and cheaply identifies which receipts deserve a
   * ground-truth entry.
   */
  if (MODELS.length > 1) {
    const disagreements = [];
    for (const row of rows) {
      if (truth[row.file]) continue;
      const results = MODELS.map((m) => row.byModel[m]).filter((r) => r?.ok);
      if (results.length < 2) continue;
      for (const field of ["vendor", "total", "gstAmount", "invoiceNumber"]) {
        const values = results.map((r) => JSON.stringify(r.receipt[field]));
        if (new Set(values).size > 1) {
          disagreements.push(`  ${pad(row.file.slice(0, 40), 42)} ${pad(field, 14)} ${values.join("  vs  ")}`);
        }
      }
      const counts = results.map((r) => r.receipt.lineItems.length);
      if (new Set(counts).size > 1) {
        disagreements.push(`  ${pad(row.file.slice(0, 40), 42)} ${pad("lineCount", 14)} ${counts.join("  vs  ")}`);
      }
    }
    if (disagreements.length) {
      console.log("\nDISAGREEMENTS (no ground truth — check these against the paper)");
      console.log("-".repeat(nameWidth + 2 + MODELS.length * 26));
      disagreements.forEach((d) => console.log(d));
    }
  }
  console.log("");
}

await main();

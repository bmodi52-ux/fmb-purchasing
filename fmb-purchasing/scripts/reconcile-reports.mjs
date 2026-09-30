/**
 * Do the records add up? A read-only check of the figures every report is
 * built from (reports overhaul — the audit's reconciliation, kept).
 *
 *   node scripts/reconcile-reports.mjs
 *   node scripts/reconcile-reports.mjs --env .env.sandbox
 *
 * Reads through the service-role key in the given env file (.env.local by
 * default) and prints counts and sums only — no names, no descriptions, no
 * bank details — so its output can be pasted into a pull request. Run it
 * before and after a change to how reports count, and the difference is the
 * change.
 *
 * It works from the raw tables with arithmetic of its own rather than the
 * app's code, so it checks that code rather than repeating it. Exits 1 when
 * a check that must hold does not.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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
const admin = createClient(url, key, { auth: { persistSession: false } });

/** Every row, a thousand at a time — PostgREST stops at 1,000 without saying. */
async function allRows(table, columns, filter = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(admin.from(table).select(columns)).order("id").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const cents = (n) => Math.round(n * 100) / 100;
const sum = (xs, f) => cents(xs.reduce((s, x) => s + Number(f(x) ?? 0), 0));
const money = (n) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const lineCount = (xs) => `${xs.length} ${xs.length === 1 ? "line" : "lines"}`;
const SPEND = new Set(["submitted", "approved", "paid"]);
const APPROVED = new Set(["approved", "paid"]);

const sydneyDay = (instant) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));

const [expenses, lines, categories] = await Promise.all([
  allRows(
    "expenses",
    "id, status, total, gst_amount, receipt_total, receipt_date, report_date, created_at, payment_date, payment_run_id"
  ),
  allRows("expense_line_items", "id, expense_id, category_id, line_total, line_gst, not_on_receipt, kind, is_capital"),
  allRows("categories", "id, parent_category_id"),
]);

const project = new URL(url).hostname.split(".")[0];
console.log(`Project ${project} · ${expenses.length} expenses · ${lines.length} lines\n`);

const byStatus = {};
for (const e of expenses) byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
console.log(`By status: ${Object.entries(byStatus).map(([s, n]) => `${s} ${n}`).join(", ")}\n`);

const linesOf = new Map();
for (const l of lines) linesOf.set(l.expense_id, [...(linesOf.get(l.expense_id) ?? []), l]);

let failed = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed += 1;
}
function note(label, detail) {
  console.log(`note ${label}${detail ? ` — ${detail}` : ""}`);
}

// Each expense is its lines ------------------------------------------------
const totalOff = expenses.filter((e) => Math.abs(sum(linesOf.get(e.id) ?? [], (l) => l.line_total) - Number(e.total)) > 0.01);
check("Every expense's lines add up to its total", totalOff.length === 0, `${expenses.length - totalOff.length} of ${expenses.length}`);
const gstOff = expenses.filter((e) => Math.abs(sum(linesOf.get(e.id) ?? [], (l) => l.line_gst) - Number(e.gst_amount)) > 0.01);
check("Every expense's GST is its lines' GST", gstOff.length === 0, `${expenses.length - gstOff.length} of ${expenses.length}`);
const empty = expenses.filter((e) => !(linesOf.get(e.id)?.length));
check("No expense without lines", empty.length === 0, `${empty.length}`);

// Spend -------------------------------------------------------------------
const spend = expenses.filter((e) => SPEND.has(e.status));
const spendIds = new Set(spend.map((e) => e.id));
const spendLines = lines.filter((l) => spendIds.has(l.expense_id));
check(
  "Spend by line equals spend by expense",
  Math.abs(sum(spendLines, (l) => l.line_total) - sum(spend, (e) => e.total)) <= 0.01,
  `${money(sum(spend, (e) => e.total))} across ${spend.length} expenses`
);

// Report dates (0083): the receipt date, else the day it was submitted in Sydney.
const dateOff = expenses.filter((e) => e.report_date !== (e.receipt_date ?? sydneyDay(e.created_at)));
check("Every report date is the receipt date, or the Sydney day submitted", dateOff.length === 0, `${dateOff.length} differ`);

// Categories ---------------------------------------------------------------
const parents = new Set(categories.map((c) => c.parent_category_id).filter(Boolean));
const known = new Set(categories.map((c) => c.id));
const onLeaf = spendLines.filter((l) => l.category_id && !parents.has(l.category_id));
const onParent = spendLines.filter((l) => l.category_id && parents.has(l.category_id));
const none = spendLines.filter((l) => !l.category_id);
const unknown = spendLines.filter((l) => l.category_id && !known.has(l.category_id));
check("Every category on a line exists", unknown.length === 0, `${unknown.length}`);
check(
  "Leaf + parent + uncategorised = spend",
  Math.abs(sum(onLeaf, (l) => l.line_total) + sum(onParent, (l) => l.line_total) + sum(none, (l) => l.line_total) - sum(spendLines, (l) => l.line_total)) <= 0.01,
  `leaf ${money(sum(onLeaf, (l) => l.line_total))}, parent ${money(sum(onParent, (l) => l.line_total))} (${lineCount(onParent)}), none ${money(sum(none, (l) => l.line_total))} (${lineCount(none)})`
);

// GST, as the return would have it -----------------------------------------
const approved = expenses.filter((e) => APPROVED.has(e.status));
const approvedIds = new Set(approved.map((e) => e.id));
const approvedLines = lines.filter((l) => approvedIds.has(l.expense_id));
const g10 = sum(approvedLines.filter((l) => l.is_capital), (l) => l.line_total);
const g11 = sum(approvedLines.filter((l) => !l.is_capital), (l) => l.line_total);
const oneB = sum(approvedLines, (l) => l.line_gst);
check("G10 + G11 = approved and paid spend", Math.abs(g10 + g11 - sum(approved, (e) => e.total)) <= 0.01, `G10 ${money(g10)}, G11 ${money(g11)}`);
// The Xero file codes a line taxable when it carries any GST, either sign.
const taxableGst = sum(approvedLines.filter((l) => Number(l.line_gst ?? 0) !== 0), (l) => l.line_gst);
check("GST on lines Xero codes taxable = 1B", Math.abs(taxableGst - oneB) <= 0.01, `1B ${money(oneB)}`);
const negative = lines.filter((l) => Number(l.line_gst ?? 0) < 0);
note("Lines with negative GST (discounts)", `${negative.length}`);

// Receipts -------------------------------------------------------------------
const withReceiptTotal = spend.filter((e) => e.receipt_total != null);
const gaps = withReceiptTotal.filter((e) => {
  const onReceipt = sum((linesOf.get(e.id) ?? []).filter((l) => !l.not_on_receipt), (l) => l.line_total);
  return Math.abs(Number(e.receipt_total) - onReceipt) > 0.01;
});
note("Receipts whose lines on it don't reach its total", `${gaps.length} of ${withReceiptTotal.length}`);
const offReceipt = spendLines.filter((l) => l.not_on_receipt);
note("Lines claimed beyond the receipt", `${offReceipt.length}, ${money(sum(offReceipt, (l) => l.line_total))}`);

// Payments -------------------------------------------------------------------
const paid = expenses.filter((e) => e.status === "paid");
const unpaidDate = paid.filter((e) => !e.payment_date);
check("Every paid expense has a payment date", unpaidDate.length === 0, `${paid.length - unpaidDate.length} of ${paid.length}`);
note("Paid expenses on a payment run", `${paid.filter((e) => e.payment_run_id).length} of ${paid.length}`);
const unpaidWithDate = expenses.filter((e) => e.status !== "paid" && e.payment_date);
check("Nothing unpaid carries a payment date", unpaidWithDate.length === 0, `${unpaidWithDate.length}`);

console.log(failed ? `\n${failed} check${failed === 1 ? "" : "s"} failed.` : "\nEverything that must hold, holds.");
process.exitCode = failed ? 1 : 0;

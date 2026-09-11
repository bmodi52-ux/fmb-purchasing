/**
 * Scoring a receipt reading against values someone has confirmed (#49).
 *
 * The same rules scripts/compare-extraction.mjs has always used, here so the
 * scheduled check and the comparison script can't drift apart. Only fields
 * the confirmed values state are scored: an entry can assert the three things
 * someone verified without pretending to know the rest.
 */

export type ExpectedReceipt = {
  vendor?: string;
  abn?: string;
  invoiceNumber?: string;
  date?: string;
  subtotal?: number;
  gstAmount?: number;
  total?: number;
  lineCount?: number;
  payeeName?: string;
  notes?: string;
};

export type ReadReceipt = {
  vendor: string | null;
  abn: string | null;
  invoiceNumber: string | null;
  date: string | null;
  subtotal: number | null;
  gstAmount: number | null;
  total: number | null;
  lineItems: unknown[];
  payee?: { name: string | null } | null;
};

export type Check = { field: string; ok: boolean; got: unknown; want: unknown };

export const SCORED_FIELDS = [
  "vendor",
  "abn",
  "invoiceNumber",
  "date",
  "subtotal",
  "gstAmount",
  "total",
  "lineCount",
  "payeeName",
] as const;

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const money = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100) / 100);
const contains = (a: unknown, b: unknown) => String(a ?? "").toLowerCase().includes(String(b).toLowerCase());

export function scoreReading(receipt: ReadReceipt, expected: ExpectedReceipt): { checks: Check[]; passed: number; total: number } {
  const checks: Check[] = [];
  const add = (field: string, ok: boolean, got: unknown, want: unknown) => checks.push({ field, ok, got, want });

  if (expected.vendor !== undefined) add("vendor", contains(receipt.vendor, expected.vendor), receipt.vendor, expected.vendor);
  if (expected.abn !== undefined) add("abn", digits(receipt.abn) === digits(expected.abn), receipt.abn, expected.abn);
  if (expected.invoiceNumber !== undefined)
    add("invoiceNumber", contains(receipt.invoiceNumber, expected.invoiceNumber), receipt.invoiceNumber, expected.invoiceNumber);
  if (expected.date !== undefined) add("date", contains(receipt.date, expected.date), receipt.date, expected.date);
  if (expected.subtotal !== undefined)
    add("subtotal", money(receipt.subtotal) === money(expected.subtotal), receipt.subtotal, expected.subtotal);
  if (expected.gstAmount !== undefined)
    add("gstAmount", money(receipt.gstAmount) === money(expected.gstAmount), receipt.gstAmount, expected.gstAmount);
  if (expected.total !== undefined) add("total", money(receipt.total) === money(expected.total), receipt.total, expected.total);
  if (expected.lineCount !== undefined)
    add("lineCount", receipt.lineItems.length === expected.lineCount, receipt.lineItems.length, expected.lineCount);
  if (expected.payeeName !== undefined)
    add("payeeName", contains(receipt.payee?.name, expected.payeeName), receipt.payee?.name ?? null, expected.payeeName);

  return { checks, passed: checks.filter((c) => c.ok).length, total: checks.length };
}

/** Whether confirmed values state anything that can be scored. */
export function hasScoredFields(expected: ExpectedReceipt): boolean {
  return SCORED_FIELDS.some((f) => expected[f] !== undefined);
}

export type RunTotals = { checks: number; passed: number; byField: Record<string, { checks: number; passed: number }> };

export function totalsOf(results: { checks: Check[] }[]): RunTotals {
  const byField: RunTotals["byField"] = {};
  let checks = 0;
  let passed = 0;
  for (const r of results) {
    for (const c of r.checks) {
      checks++;
      if (c.ok) passed++;
      const f = (byField[c.field] ??= { checks: 0, passed: 0 });
      f.checks++;
      if (c.ok) f.passed++;
    }
  }
  return { checks, passed, byField };
}

/** Percentage of checks passed, to one decimal place; null when nothing was checked. */
export function accuracy(t: { checks: number; passed: number }): number | null {
  return t.checks > 0 ? Math.round((t.passed / t.checks) * 1000) / 10 : null;
}

/**
 * Whether a run read worse than the one before by more than the allowed
 * margin, in percentage points. Only runs over the same number of checks are
 * compared, so adding a receipt to the set isn't mistaken for a decline.
 */
export function readingGotWorse(
  latest: { checks: number; passed: number },
  previous: { checks: number; passed: number } | null,
  dropPoints: number
): boolean {
  if (!previous || previous.checks !== latest.checks) return false;
  const now = accuracy(latest);
  const before = accuracy(previous);
  return now !== null && before !== null && before - now > dropPoints;
}

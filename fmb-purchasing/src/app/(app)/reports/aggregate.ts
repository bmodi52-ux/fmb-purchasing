/**
 * Every number the Reports page shows, computed here and nowhere else.
 *
 * Pure functions over plain rows: no database, no React. That is the point —
 * this is the only money arithmetic in the app outside the SQL costing views,
 * and it is the part a reader will quote to someone. It gets tests.
 *
 * Aggregation is at **line-item** level throughout. Verified against the live
 * data: every expense has line items and they sum exactly to the expense
 * total, so line totals are a faithful decomposition rather than an
 * approximation — and only lines carry category and item, which the
 * dashboard has to cut by.
 */

export type ExpenseRecord = {
  id: string;
  expenseNumber: string | null;
  vendorId: string | null;
  vendorName: string;
  status: string;
  /** ISO date. Null when the receipt carried no date. */
  receiptDate: string | null;
  createdAt: string;
  total: number;
  gst: number;
};

export type LineRecord = {
  expenseId: string;
  categoryId: string | null;
  categoryName: string;
  itemId: string | null;
  itemName: string;
  lineTotal: number;
  quantity: number | null;
};

export type Filters = {
  /** null means every month in the period. */
  month: string | null;
  vendorId: string | null;
  categoryId: string | null;
  itemId: string | null;
};

export const NO_FILTERS: Filters = { month: null, vendorId: null, categoryId: null, itemId: null };

/**
 * The date an expense counts against.
 *
 * Prefers the date on the receipt, because that is when the money was spent.
 * Falls back to submission for the expenses that arrived without one —
 * roughly a third of them today — so nothing silently drops out of a
 * time-based chart.
 */
export function expenseDate(e: ExpenseRecord): string {
  return e.receiptDate ?? e.createdAt.slice(0, 10);
}

/** "2026-05" — the bucket key for month grouping. */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  // Constructed in UTC and read back in UTC: a local-time Date built from a
  // month boundary can land in the previous month west of Greenwich.
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-AU", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

/* ------------------------------------------------------------------ */
/* Slicing                                                             */
/* ------------------------------------------------------------------ */

export type Slice = {
  expenses: ExpenseRecord[];
  lines: LineRecord[];
};

/**
 * Applies the filter bar to a period's rows.
 *
 * A category or item filter narrows the *lines*, then keeps only the
 * expenses that still have one. That ordering matters: an expense is
 * "in" a category because one of its lines is, and its headline total then
 * reflects only the matching lines — otherwise filtering by category would
 * report the whole receipt, including everything that didn't match.
 */
export function applyFilters(
  expenses: ExpenseRecord[],
  lines: LineRecord[],
  filters: Filters
): Slice {
  let keptExpenses = expenses;

  if (filters.month) {
    keptExpenses = keptExpenses.filter((e) => monthKey(expenseDate(e)) === filters.month);
  }
  if (filters.vendorId) {
    keptExpenses = keptExpenses.filter((e) => e.vendorId === filters.vendorId);
  }

  const keptIds = new Set(keptExpenses.map((e) => e.id));
  let keptLines = lines.filter((l) => keptIds.has(l.expenseId));

  if (filters.categoryId) {
    keptLines = keptLines.filter((l) => l.categoryId === filters.categoryId);
  }
  if (filters.itemId) {
    keptLines = keptLines.filter((l) => l.itemId === filters.itemId);
  }

  // Narrowing lines can empty an expense out; drop those so counts agree
  // with what the breakdowns below actually add up.
  if (filters.categoryId || filters.itemId) {
    const withLines = new Set(keptLines.map((l) => l.expenseId));
    keptExpenses = keptExpenses.filter((e) => withLines.has(e.id));
  }

  return { expenses: keptExpenses, lines: keptLines };
}

/* ------------------------------------------------------------------ */
/* Headline figures                                                    */
/* ------------------------------------------------------------------ */

export type Totals = {
  spend: number;
  gst: number;
  expenseCount: number;
  lineCount: number;
  averageExpense: number;
};

export function totals(slice: Slice): Totals {
  const spend = sum(slice.lines.map((l) => l.lineTotal));
  // GST is only recorded per expense, so it is only meaningful when whole
  // expenses are in play. Under a category or item filter the lines are a
  // subset and this would overstate; callers hide it in that case.
  const gst = sum(slice.expenses.map((e) => e.gst));
  return {
    spend,
    gst,
    expenseCount: slice.expenses.length,
    lineCount: slice.lines.length,
    averageExpense: slice.expenses.length === 0 ? 0 : spend / slice.expenses.length,
  };
}

/** Signed change as a fraction, or null when there's no baseline to compare to. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

/* ------------------------------------------------------------------ */
/* Breakdowns                                                          */
/* ------------------------------------------------------------------ */

export type Bucket = {
  key: string;
  label: string;
  spend: number;
  count: number;
};

function rank(buckets: Map<string, Bucket>): Bucket[] {
  return [...buckets.values()].sort((a, b) => b.spend - a.spend || a.label.localeCompare(b.label));
}

export function byMonth(slice: Slice): Bucket[] {
  const dateByExpense = new Map(slice.expenses.map((e) => [e.id, expenseDate(e)]));
  const out = new Map<string, Bucket>();

  for (const line of slice.lines) {
    const date = dateByExpense.get(line.expenseId);
    if (!date) continue;
    const key = monthKey(date);
    const bucket = out.get(key) ?? { key, label: formatMonthLabel(key), spend: 0, count: 0 };
    bucket.spend += line.lineTotal;
    out.set(key, bucket);
  }
  for (const e of slice.expenses) {
    const key = monthKey(expenseDate(e));
    const bucket = out.get(key);
    if (bucket) bucket.count += 1;
  }

  // Chronological, not ranked — this one is a time axis.
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function byCategory(slice: Slice): Bucket[] {
  const out = new Map<string, Bucket>();
  for (const line of slice.lines) {
    const key = line.categoryId ?? "uncategorised";
    const bucket = out.get(key) ?? { key, label: line.categoryName, spend: 0, count: 0 };
    bucket.spend += line.lineTotal;
    bucket.count += 1;
    out.set(key, bucket);
  }
  return rank(out);
}

export function byVendor(slice: Slice): Bucket[] {
  const spendByExpense = new Map<string, number>();
  for (const line of slice.lines) {
    spendByExpense.set(line.expenseId, (spendByExpense.get(line.expenseId) ?? 0) + line.lineTotal);
  }

  const out = new Map<string, Bucket>();
  for (const e of slice.expenses) {
    const key = e.vendorId ?? `raw:${e.vendorName}`;
    const bucket = out.get(key) ?? { key, label: e.vendorName, spend: 0, count: 0 };
    bucket.spend += spendByExpense.get(e.id) ?? 0;
    bucket.count += 1;
    out.set(key, bucket);
  }
  return rank(out);
}

export function byItem(slice: Slice): Bucket[] {
  const out = new Map<string, Bucket>();
  for (const line of slice.lines) {
    const key = line.itemId ?? `raw:${line.itemName}`;
    const bucket = out.get(key) ?? { key, label: line.itemName, spend: 0, count: 0 };
    bucket.spend += line.lineTotal;
    bucket.count += 1;
    out.set(key, bucket);
  }
  return rank(out);
}

export function byStatus(slice: Slice): Bucket[] {
  const spendByExpense = new Map<string, number>();
  for (const line of slice.lines) {
    spendByExpense.set(line.expenseId, (spendByExpense.get(line.expenseId) ?? 0) + line.lineTotal);
  }

  // Fixed order — a pipeline, so it should read in pipeline order rather
  // than jumping about as the numbers change.
  const ORDER = ["submitted", "approved", "paid", "declined"];
  const LABEL: Record<string, string> = {
    submitted: "Awaiting review",
    approved: "Approved",
    paid: "Paid",
    declined: "Declined",
  };

  const out = new Map<string, Bucket>();
  for (const e of slice.expenses) {
    const bucket = out.get(e.status) ?? {
      key: e.status,
      label: LABEL[e.status] ?? e.status,
      spend: 0,
      count: 0,
    };
    bucket.spend += spendByExpense.get(e.id) ?? 0;
    bucket.count += 1;
    out.set(e.status, bucket);
  }

  return ORDER.filter((s) => out.has(s)).map((s) => out.get(s)!);
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

export type Insight = { text: string; tone: "neutral" | "up" | "down" };

const money = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });

const pct = (f: number) => `${Math.abs(Math.round(f * 100))}%`;

/**
 * Short statements about the current slice.
 *
 * Every one is arithmetic on the numbers already on screen — no forecasting,
 * no "unusual" judgements from a handful of rows. A dashboard that guesses
 * loses the reader's trust the first time it guesses wrong, and at this
 * data volume it would.
 */
export function insights(
  current: Slice,
  previous: Slice | null,
  periodLabel: string,
  previousLabel: string
): Insight[] {
  const out: Insight[] = [];
  const now = totals(current);
  if (now.expenseCount === 0) return out;

  if (previous) {
    const before = totals(previous);
    const change = percentChange(now.spend, before.spend);
    if (change !== null && Math.abs(change) >= 0.01) {
      out.push({
        text: `Spend is ${pct(change)} ${change > 0 ? "higher" : "lower"} than ${previousLabel} (${money(now.spend)} vs ${money(before.spend)}).`,
        tone: change > 0 ? "up" : "down",
      });
    } else if (before.expenseCount > 0) {
      out.push({
        text: `Spend is roughly level with ${previousLabel} (${money(now.spend)} vs ${money(before.spend)}).`,
        tone: "neutral",
      });
    }
  }

  const categories = byCategory(current);
  if (categories.length > 0 && now.spend > 0) {
    const top = categories[0];
    const share = top.spend / now.spend;
    out.push({
      text:
        categories.length === 1
          ? `Everything in ${periodLabel} was ${top.label}.`
          : `${top.label} is the largest category at ${pct(share)} of spend (${money(top.spend)}).`,
      tone: "neutral",
    });
  }

  const vendors = byVendor(current);
  if (vendors.length > 1 && now.spend > 0) {
    const top = vendors[0];
    out.push({
      text: `${top.label} accounts for ${pct(top.spend / now.spend)} of spend across ${top.count} ${top.count === 1 ? "expense" : "expenses"}.`,
      tone: "neutral",
    });
  }

  const awaiting = byStatus(current).find((s) => s.key === "submitted");
  if (awaiting && awaiting.count > 0) {
    out.push({
      text: `${awaiting.count} ${awaiting.count === 1 ? "expense is" : "expenses are"} still awaiting review, worth ${money(awaiting.spend)}.`,
      tone: "neutral",
    });
  }

  return out;
}

function sum(values: number[]): number {
  // Rounded to cents at the end: adding many two-decimal values in binary
  // floating point drifts, and a total that renders as $1,319.9999999 in a
  // CSV export is the kind of thing someone has to reconcile by hand.
  return Math.round(values.reduce((a, b) => a + b, 0) * 100) / 100;
}

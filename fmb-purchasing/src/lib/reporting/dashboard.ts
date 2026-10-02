/**
 * The Reports dashboard's sums. Pure.
 *
 * The dashboard is a way in, not another report: every figure on it is one a
 * report already computes — spend from the ledger the Spending report reads,
 * what is waiting from Money out, budgets from Budgets — taken for a period
 * and laid side by side, each linked to the report it came from. Nothing here
 * counts anything a different way.
 */

import { addDays, dayCount, monthSpans } from "@/lib/periods";
import type { BudgetTotals } from "@/lib/budget-actuals";
import { expenseDate, type Bucket, type MonthCalendar, type Slice } from "./aggregate.ts";
import type { DateRange } from "./ledger-rows.ts";
import type { Waiting } from "./money-out.ts";

const cents = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* Spend over time                                                     */
/* ------------------------------------------------------------------ */

export type TrendGrain = "day" | "week" | "month";

export type TrendPoint = {
  key: string;
  label: string;
  value: number;
  count: number;
  /** What the same stretch of the period before came to; null when there is nothing to compare with. */
  compare: number | null;
  /** Its month or week is not over yet, so it is not yet the figure it will be. */
  underWay: boolean;
};

/** How finely a range is drawn: a fortnight by the day, a quarter by the week, anything longer by the month. */
export function trendGrain(range: DateRange): TrendGrain {
  const days = dayCount(range.start, range.end);
  if (days <= 14) return "day";
  if (days <= 100) return "week";
  return "month";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/** The Monday on or before a day. */
function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 is Sunday
  return addDays(iso, -((weekday + 6) % 7));
}

type Span = { key: string; label: string; start: string; end: string };

/**
 * A range cut into what it is drawn by. Months are the calendar's own, cut
 * to the range; weeks start on Monday, the first where the range does.
 */
function spansOf(range: DateRange, grain: TrendGrain, calendar: MonthCalendar): Span[] {
  if (range.end < range.start) return [];
  if (grain === "month") return monthSpans(range, calendar);
  const out: Span[] = [];
  for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
    const last = out.at(-1);
    if (grain === "week" && last && mondayOf(day) === mondayOf(last.start)) last.end = day;
    else out.push({ key: day, label: dayLabel(day), start: day, end: day });
  }
  return out;
}

/** What a slice comes to in each span, and how many expenses fall in it. */
function sumBySpan(spans: (Span | null)[], slice: Slice): { value: number; count: number }[] {
  const totals = spans.map(() => ({ value: 0, count: 0 }));
  const spanOfDay = new Map<string, number>();
  const at = (day: string) => {
    let i = spanOfDay.get(day);
    if (i === undefined) {
      i = spans.findIndex((s) => s !== null && day >= s.start && day <= s.end);
      spanOfDay.set(day, i);
    }
    return i;
  };
  const spanOfExpense = new Map<string, number>();
  for (const e of slice.expenses) {
    const i = at(expenseDate(e));
    spanOfExpense.set(e.id, i);
    if (i >= 0) totals[i].count += 1;
  }
  for (const l of slice.lines) {
    const i = spanOfExpense.get(l.expenseId) ?? -1;
    if (i >= 0) totals[i].value += l.lineTotal;
  }
  return totals;
}

/**
 * Spend across a range, in buckets it can be read by. Every day, week or
 * month up to today is present, empty or not — a month with nothing spent is
 * part of the picture — and none is drawn for time that hasn't happened.
 *
 * Given the period before (`previous`), each bucket also carries what the
 * same one came to then: the same month of the year before, or the same days
 * counted from the start for weeks and days. And the bucket holding today is
 * marked as under way, so a part-month beside whole ones is not read as a
 * fall.
 */
export function spendTrend(
  slice: Slice,
  range: DateRange,
  today: string,
  calendar: MonthCalendar = "gregorian",
  previous?: { slice: Slice; range: DateRange }
): { grain: TrendGrain; points: TrendPoint[] } {
  const grain = trendGrain(range);
  const last = range.end < today ? range.end : today;
  const spans = spansOf({ start: range.start, end: last }, grain, calendar);
  const totals = sumBySpan(spans, slice);

  let before: ({ value: number; count: number } | null)[] = spans.map(() => null);
  if (previous) {
    // Months are matched by their place in the year; weeks and days by how
    // far they are from the start, since the two periods' weeks need not
    // fall on the same dates.
    const months = grain === "month" ? monthSpans(previous.range, calendar) : [];
    const offset = (day: string) => addDays(previous.range.start, dayCount(range.start, day) - 1);
    const matched: (Span | null)[] = spans.map((s, i) => {
      if (grain === "month") return months[i] ?? null;
      const start = offset(s.start);
      if (start > previous.range.end) return null;
      const end = offset(s.end);
      return { ...s, start, end: end > previous.range.end ? previous.range.end : end };
    });
    const sums = sumBySpan(matched, previous.slice);
    before = matched.map((m, i) => (m ? sums[i] : null));
  }

  // The bucket today is in is under way if its own month or week runs past
  // today — whether or not the range does: "this year so far" ends today by
  // definition, and its last month is still only part of a month.
  let openUntil = today;
  if (grain !== "day" && today >= range.start && today <= range.end) {
    openUntil = grain === "month" ? monthSpans({ start: today, end: addDays(today, 31) }, calendar)[0].end : addDays(mondayOf(today), 6);
  }

  return {
    grain,
    points: spans.map((s, i) => ({
      key: s.key,
      label: s.label,
      value: cents(totals[i].value),
      count: totals[i].count,
      compare: before[i] ? cents(before[i]!.value) : null,
      underWay: i === spans.length - 1 && today < openUntil,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Rankings                                                            */
/* ------------------------------------------------------------------ */

export type Ranked = { label: string; value: number; count: number };

/**
 * The largest of a ranking. A discount line is an item with negative spend,
 * and belongs at the bottom of a ledger, not in a chart of what was bought
 * most: only what was spent on is ranked.
 */
export function topOf(buckets: Bucket[], n = 10): Ranked[] {
  return buckets
    .filter((b) => b.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, n)
    .map((b) => ({ label: leafFirst(b.label), value: cents(b.spend), count: b.count }));
}

/**
 * "Meat & Poultry › Chicken" as "Chicken · Meat & Poultry". A ranking has a
 * narrow column for names and cuts long ones short; with the heading first,
 * two categories under one heading are cut to the same words. The part that
 * tells them apart goes first.
 */
export function leafFirst(label: string): string {
  const parts = label.split(" › ");
  return parts.length === 2 ? `${parts[1]} · ${parts[0]}` : label;
}

/* ------------------------------------------------------------------ */
/* What is owed                                                        */
/* ------------------------------------------------------------------ */

export type Overdue = {
  count: number;
  amount: number;
  /** Days the longest-waiting one has waited since approval; null when none is overdue. */
  oldestDays: number | null;
  /** How many days of waiting makes one overdue. */
  afterDays: number;
  /** Everything approved and unpaid, overdue or not, for "N of M". */
  waitingCount: number;
  waitingAmount: number;
};

/**
 * Approved expenses that have waited to be paid for longer than the app
 * itself thinks they should: the days after which a payment reminder is
 * escalated (App settings → reminders). An expense has no due date, so this
 * is the one rule the app has for "late" — and using it means the dashboard
 * and the reminders call the same things late.
 */
export function overdueOf(waiting: Waiting, afterDays: number): Overdue {
  const late = waiting.rows.filter((r) => r.days > afterDays);
  return {
    count: late.length,
    amount: cents(late.reduce((s, r) => s + r.total, 0)),
    oldestDays: late.length ? Math.max(...late.map((r) => r.days)) : null,
    afterDays,
    waitingCount: waiting.count,
    waitingAmount: waiting.amount,
  };
}

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

export type BudgetUse = {
  budgeted: number;
  /** Spent in the categories that have a budget. */
  spent: number;
  /** Spent as a share of budgeted; null when nothing is budgeted. */
  used: number | null;
  remaining: number | null;
};

export function budgetUse(totals: BudgetTotals): BudgetUse {
  return {
    budgeted: totals.budgeted,
    spent: totals.spentAgainstBudgets,
    used: totals.budgeted > 0 ? totals.spentAgainstBudgets / totals.budgeted : null,
    remaining: totals.remaining,
  };
}

/* ------------------------------------------------------------------ */
/* Old addresses                                                       */
/* ------------------------------------------------------------------ */

/** What only the Spending report reads from an address. */
const SPENDING_PARAMS = ["section", "vendor", "category", "item", "status", "breakdownBy", "compareBy", "sort", "dir", "page"];

/**
 * Whether an address at /reports is one for the Spending report, which lived
 * there before the dashboard did. A saved link or bookmark with a section or
 * a filter in it meant that report, and is sent on to it.
 */
export function isSpendingAddress(params: Record<string, string | string[] | undefined>): boolean {
  return SPENDING_PARAMS.some((key) => params[key] !== undefined);
}

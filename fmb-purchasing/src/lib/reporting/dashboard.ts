/**
 * The Reports dashboard's sums. Pure.
 *
 * The dashboard is a way in, not another report: every figure on it is one a
 * report already computes — spend from the ledger the Spending report reads,
 * what is waiting from Money out, budgets from Budgets — taken for a period
 * and laid side by side, each linked to the report it came from. Nothing here
 * counts anything a different way.
 */

import { addDays, dayCount } from "@/lib/periods";
import type { BudgetTotals } from "@/lib/budget-actuals";
import { byMonth, expenseDate, type Bucket, type MonthCalendar, type Slice } from "./aggregate.ts";
import type { DateRange } from "./ledger-rows.ts";
import type { Waiting } from "./money-out.ts";

const cents = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */
/* Spend over time                                                     */
/* ------------------------------------------------------------------ */

export type TrendGrain = "day" | "week" | "month";

export type TrendPoint = { key: string; label: string; value: number; count: number };

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

/**
 * Spend across a range, in buckets it can be read by. Days and weeks are all
 * present up to today, empty or not — a week with nothing spent is part of
 * the picture — and none are drawn for days that haven't happened. Months are
 * the ones the Spending report shows, in the period's own calendar.
 */
export function spendTrend(slice: Slice, range: DateRange, today: string, calendar: MonthCalendar = "gregorian"): { grain: TrendGrain; points: TrendPoint[] } {
  const grain = trendGrain(range);
  if (grain === "month") {
    return {
      grain,
      points: byMonth(slice, calendar).map((b) => ({ key: b.key, label: b.label, value: cents(b.spend), count: b.count })),
    };
  }

  const last = range.end < today ? range.end : today;
  const bucketOf = (day: string) => {
    if (grain === "day") return day;
    const monday = mondayOf(day);
    // The first week starts where the range does, not on the Monday before it.
    return monday < range.start ? range.start : monday;
  };

  const points = new Map<string, TrendPoint>();
  for (let day = range.start; day <= last; day = addDays(day, 1)) {
    const key = bucketOf(day);
    if (!points.has(key)) points.set(key, { key, label: dayLabel(key), value: 0, count: 0 });
  }

  const dateOf = new Map(slice.expenses.map((e) => [e.id, expenseDate(e)]));
  for (const e of slice.expenses) {
    const point = points.get(bucketOf(expenseDate(e)));
    if (point) point.count += 1;
  }
  for (const l of slice.lines) {
    const day = dateOf.get(l.expenseId);
    const point = day ? points.get(bucketOf(day)) : undefined;
    if (point) point.value += l.lineTotal;
  }
  return { grain, points: [...points.values()].map((p) => ({ ...p, value: cents(p.value) })) };
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

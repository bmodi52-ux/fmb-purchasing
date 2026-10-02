/**
 * The months a period is read by. Pure.
 *
 * Spend grouped by month only has the months something was spent in, so a
 * year with a quiet quarter drew as nine columns side by side and the gap
 * went unseen. A period's months are its own — every one of them up to
 * today, whether or not anything was bought — and a chart, a table and a
 * download of one period should all list the same ones.
 */

import { monthSpans } from "@/lib/periods";
import { monthBucket, type Bucket, type Comparison, type MonthBreakdown, type MonthCalendar } from "./aggregate.ts";
import type { DateRange } from "./ledger-rows.ts";

export type Month = { key: string; label: string };

/** Every month of a range up to today, in its calendar. None for a range that has not started. */
export function monthAxis(range: DateRange, today: string, calendar: MonthCalendar): Month[] {
  const end = range.end < today ? range.end : today;
  if (end < range.start) return [];
  // Named as the figures name them (aggregate monthBucket), so the two can be matched by key.
  return monthSpans({ start: range.start, end }, calendar).map((span) => monthBucket(span.start, calendar));
}

/**
 * The axis, plus any month the figures have that it lacks, in date order. A
 * receipt dated ahead of today is in the period and in its total, so its
 * month is shown rather than dropped for being in the future.
 */
function withAnyOthers(axis: Month[], have: Month[]): Month[] {
  const byKey = new Map(axis.map((m) => [m.key, m]));
  for (const m of have) if (!byKey.has(m.key)) byKey.set(m.key, { key: m.key, label: m.label });
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Figures laid out by one list of months, moved onto another: nought where a month had none. */
function moved(values: number[], from: Month[], to: Month[]): number[] {
  const at = new Map(from.map((m, i) => [m.key, i]));
  return to.map((m) => {
    const i = at.get(m.key);
    return i === undefined ? 0 : (values[i] ?? 0);
  });
}

/** Spend by month, with the months nothing was spent in. */
export function monthlyOn(axis: Month[], monthly: Bucket[]): Bucket[] {
  const have = new Map(monthly.map((b) => [b.key, b]));
  return withAnyOthers(axis, monthly).map((m) => have.get(m.key) ?? { key: m.key, label: m.label, spend: 0, gst: 0, count: 0 });
}

/** A split by month, with the months nothing was spent in. */
export function breakdownOn(axis: Month[], breakdown: MonthBreakdown): MonthBreakdown {
  const months = withAnyOthers(axis, breakdown.months);
  return { ...breakdown, months, series: breakdown.series.map((s) => ({ ...s, values: moved(s.values, breakdown.months, months) })) };
}

/** A comparison by month, with the months nothing was spent in. Its scale is unchanged: an empty month is not a taller one. */
export function comparisonOn(axis: Month[], comparison: Comparison): Comparison {
  const months = withAnyOthers(axis, comparison.months);
  return { ...comparison, months, subjects: comparison.subjects.map((s) => ({ ...s, values: moved(s.values, comparison.months, months) })) };
}

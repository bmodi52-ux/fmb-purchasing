/**
 * Everything the Reports page shows, computed on the server.
 *
 * The page used to send the browser every expense and line in the period —
 * and in the period before — and work the figures out there: a year of a busy
 * kitchen's receipts crossing the network on every click of a filter, to be
 * reduced to a dozen numbers and a chart. Now the server does the reducing and
 * sends the dozen numbers. Only the section on screen is computed, since it
 * is the only one drawn.
 *
 * Pure, over the same aggregate.ts functions as before, so the figures are
 * exactly what they were.
 */

import {
  byCategory,
  byItem,
  byMonth,
  byMonthBreakdown,
  byStatus,
  byVendor,
  compare,
  insights,
  totals,
  MAX_COMPARE_SUBJECTS,
  type Bucket,
  type Comparison,
  type Dimension,
  type Insight,
  type MonthBreakdown,
  type MonthCalendar,
  type Slice,
  type Totals,
} from "./aggregate.ts";
import type { PaidCostRow } from "./ledger-rows.ts";
import type { ReportQuery } from "./query.ts";
import { averageUnitCosts, perUnitRows, type AverageUnitCost, type PerUnitRow } from "./unit-costs.ts";

export type SpendSection =
  | { key: "overview"; statusMix: Bucket[] }
  | { key: "breakdown"; dimension: Dimension; ranked: Bucket[]; overTime: MonthBreakdown }
  | {
      key: "compare";
      dimension: Dimension;
      comparison: Comparison;
      /** How many subjects were picked in the filter bar — none means the top spenders are shown. */
      chosenCount: number;
      /** Per-item average paid per unit, for item cards. */
      unitCostByItem: Record<string, AverageUnitCost>;
    }
  | { key: "unit-costs"; rows: PerUnitRow[] }
  | {
      key: "transactions";
      /** Newest first. The page may show only the first of them; the download has all. */
      rows: TransactionRow[];
      /** How many there are in all, before any is left off the page. */
      total: number;
    };

/**
 * One line behind the figures: every report on the page adds these up, so
 * listing them is how any figure is traced to the receipts it came from.
 */
export type TransactionRow = {
  expenseId: string;
  entry: string | null;
  date: string;
  vendor: string;
  /** The item, or what the receipt said when the line matched none. */
  item: string;
  category: string;
  status: string;
  amount: number;
  gst: number;
};

/** How many transactions the page lists; the download has them all. */
export const TRANSACTIONS_ON_SCREEN = 1000;

/** The report as the page is sent it: a long transaction list cut to what a page can hold. */
export function forScreen(report: SpendReport): SpendReport {
  const s = report.section;
  if (s.key !== "transactions" || s.rows.length <= TRANSACTIONS_ON_SCREEN) return report;
  return { ...report, section: { ...s, rows: s.rows.slice(0, TRANSACTIONS_ON_SCREEN) } };
}

const STATUS_WORD: Record<string, string> = { submitted: "Awaiting review", approved: "Approved", paid: "Paid" };

/** A slice's lines as transactions, newest first. */
export function transactionRows(slice: Slice): TransactionRow[] {
  const expenseById = new Map(slice.expenses.map((e) => [e.id, e]));
  return slice.lines
    .flatMap((l) => {
      const e = expenseById.get(l.expenseId);
      if (!e) return [];
      return [
        {
          expenseId: e.id,
          entry: e.expenseNumber,
          date: e.reportDate,
          vendor: e.vendorName,
          item: l.itemName,
          category: l.categoryName,
          status: STATUS_WORD[e.status] ?? e.status,
          amount: l.lineTotal,
          gst: l.gst,
        },
      ];
    })
    .sort((a, b) => b.date.localeCompare(a.date) || (b.entry ?? "").localeCompare(a.entry ?? ""));
}

export type SpendReport = {
  now: Totals;
  /** Null when the period before had nothing in it to compare with. */
  before: Totals | null;
  monthly: Bucket[];
  insights: Insight[];
  section: SpendSection;
  /** Which months `monthly` and the sections' months are. */
  calendar: MonthCalendar;
};

export function computeSpendReport({
  current,
  previous,
  unitCosts,
  query,
  periodLabel,
  previousLabel,
  calendar = "gregorian",
}: {
  current: Slice;
  previous: Slice | null;
  /** The period's unit costs; narrowed here to the slice. */
  unitCosts: PaidCostRow[];
  query: ReportQuery;
  periodLabel: string;
  previousLabel: string;
  /** Which months to group by — Hijri for a Hijri period (lib/periods monthCalendarFor). */
  calendar?: MonthCalendar;
}): SpendReport {
  // Only items still in the slice: a category or item filter has to narrow
  // the unit costs too, or they would contradict everything above them.
  const visibleItemIds = new Set(current.lines.map((l) => l.itemId).filter(Boolean) as string[]);
  const keepItem = (itemId: string) => visibleItemIds.has(itemId);

  return {
    now: totals(current),
    before: previous ? totals(previous) : null,
    monthly: byMonth(current, calendar),
    insights: insights(current, previous, periodLabel, previousLabel),
    section: section(current, unitCosts, query, keepItem, calendar),
    calendar,
  };
}

function section(
  current: Slice,
  unitCosts: PaidCostRow[],
  query: ReportQuery,
  keepItem: (itemId: string) => boolean,
  calendar: MonthCalendar
): SpendSection {
  switch (query.section) {
    case "overview":
      return { key: "overview", statusMix: byStatus(current) };

    case "breakdown": {
      const dimension = query.breakdownBy;
      const ranked =
        dimension === "category" ? byCategory(current) : dimension === "vendor" ? byVendor(current) : byItem(current);
      return { key: "breakdown", dimension, ranked, overTime: byMonthBreakdown(current, dimension, 6, calendar) };
    }

    case "compare": {
      const dimension = query.compareBy;
      // Subjects come from the filter menus, so there is one place to pick
      // things rather than a parallel selector that could disagree with them.
      const chosen = dimension === "item" ? query.items : dimension === "category" ? query.categories : query.vendors;
      const comparison = compare(current, dimension, chosen, MAX_COMPARE_SUBJECTS, calendar);
      const unitCostByItem =
        dimension === "item"
          ? Object.fromEntries(
              averageUnitCosts(unitCosts, current, (id) => keepItem(id) && comparison.subjects.some((s) => s.key === id))
            )
          : {};
      return { key: "compare", dimension, comparison, chosenCount: chosen.length, unitCostByItem };
    }

    case "unit-costs":
      return { key: "unit-costs", rows: perUnitRows(unitCosts, current, keepItem) };

    case "transactions": {
      const rows = transactionRows(current);
      return { key: "transactions", rows, total: rows.length };
    }
  }
}

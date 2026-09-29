/**
 * Turns a saved home-page widget config into the same computed shapes
 * Reports itself renders — one dispatcher over aggregate.ts's pure
 * functions, entered from a stored config instead of the URL, so a widget
 * can never disagree with what Reports would show for the same filters.
 */

import { inPeriod, monthCalendarFor, parsePeriod } from "@/lib/periods";
import {
  applyFilters,
  expenseDate,
  byCategory,
  byVendor,
  byItem,
  byMonth,
  byMonthBreakdown,
  byStatus,
  compare,
  totals,
  MAX_COMPARE_SUBJECTS,
  type Bucket,
  type Comparison,
  type Dimension,
  type MonthBreakdown,
  type Totals,
  type Slice,
} from "@/lib/reporting/aggregate.ts";
import type { Ledger } from "@/lib/reporting/ledger-rows.ts";
import { perUnitRows, type PerUnitRow } from "@/lib/reporting/unit-costs.ts";

export type WidgetKind =
  | "spend-over-time"
  | "status-mix"
  | "ranked-chart"
  | "ranked-table"
  | "breakdown-over-time"
  | "compare-chart"
  | "compare-table"
  | "unit-cost-chart"
  | "unit-cost-table"
  | "stat-tile";

export const WIDGET_KINDS: { value: WidgetKind; label: string; needsDimension: boolean }[] = [
  { value: "spend-over-time", label: "Spend over time", needsDimension: false },
  { value: "status-mix", label: "Where it sits (by stage)", needsDimension: false },
  { value: "ranked-chart", label: "Spend by category/vendor/item (chart)", needsDimension: true },
  { value: "ranked-table", label: "Spend by category/vendor/item (table)", needsDimension: true },
  { value: "breakdown-over-time", label: "Breakdown over time", needsDimension: true },
  { value: "compare-chart", label: "Compare (chart)", needsDimension: true },
  { value: "compare-table", label: "Compare (table)", needsDimension: true },
  { value: "unit-cost-chart", label: "Unit cost trend (chart)", needsDimension: false },
  { value: "unit-cost-table", label: "Unit cost trend (table)", needsDimension: false },
  { value: "stat-tile", label: "A single figure", needsDimension: false },
];

export type StatMetric = "spend" | "expenseCount" | "averageExpense" | "gst";

export type WidgetConfig = {
  /**
   * A period code from lib/periods (#22). "h-current" and its kin roll over
   * to the new year by themselves.
   */
  period?: string;
  /** The fiscal year widgets saved before #22 carry instead of a period. */
  fy?: number;
  /** A month (YYYY-MM) inside the period — only on widgets saved before #22. */
  month: string | null;
  vendorIds: string[];
  categoryIds: string[];
  itemIds: string[];
  /** For ranked-chart/table and breakdown-over-time. */
  dimension?: Dimension;
  /** For compare-chart/table. */
  compareBy?: Dimension;
  compareSubjectIds?: string[];
  /** For unit-cost-chart/table — which item, and its label for when there's
   *  no data yet to derive one from. */
  itemId?: string;
  itemLabel?: string;
  /** For stat-tile. */
  statMetric?: StatMetric;
};

export type WidgetData =
  | { kind: "spend-over-time"; monthly: Bucket[] }
  | { kind: "status-mix"; statusMix: Bucket[] }
  | { kind: "ranked-chart" | "ranked-table"; ranked: Bucket[]; dimension: Dimension }
  | { kind: "breakdown-over-time"; breakdown: MonthBreakdown; dimension: Dimension }
  | { kind: "compare-chart" | "compare-table"; comparison: Comparison; dimension: Dimension }
  | { kind: "unit-cost-chart" | "unit-cost-table"; rows: PerUnitRow[]; itemLabel: string }
  | { kind: "stat-tile"; totals: Totals; metric: StatMetric };

/** The period a widget is set to, reading a pre-#22 widget's fiscal year as a Hijri year. */
export function widgetPeriodCode(config: Pick<WidgetConfig, "period" | "fy">): string {
  return config.period ?? (config.fy != null ? `h${config.fy}` : "h-current");
}

/** The same slice Reports would build for these filters, scoped to the widget's period. */
export function sliceFor(config: WidgetConfig, raw: Ledger, today: string): Slice {
  const period = parsePeriod(widgetPeriodCode(config), today);
  const currentIds = new Set(
    raw.expenses.filter((e) => inPeriod(period, expenseDate(e))).map((e) => e.id)
  );
  const currentExpenses = raw.expenses.filter((e) => currentIds.has(e.id));
  const currentLines = raw.lines.filter((l) => currentIds.has(l.expenseId));

  return applyFilters(currentExpenses, currentLines, {
    month: config.month,
    vendorIds: config.vendorIds,
    categoryIds: config.categoryIds,
    itemIds: config.itemIds,
  });
}

export function computeWidgetData(
  kind: WidgetKind,
  config: WidgetConfig,
  raw: Ledger,
  today: string
): WidgetData {
  const slice = sliceFor(config, raw, today);
  // A widget on a Hijri year groups by Hijri month, as Reports does.
  const calendar = monthCalendarFor(parsePeriod(widgetPeriodCode(config), today));

  switch (kind) {
    case "spend-over-time":
      return { kind, monthly: byMonth(slice, calendar) };

    case "status-mix":
      return { kind, statusMix: byStatus(slice) };

    case "ranked-chart":
    case "ranked-table": {
      const dimension = config.dimension ?? "category";
      const ranked =
        dimension === "vendor"
          ? byVendor(slice)
          : dimension === "item"
            ? byItem(slice)
            : byCategory(slice);
      return { kind, ranked, dimension };
    }

    case "breakdown-over-time": {
      const dimension = config.dimension ?? "category";
      return { kind, breakdown: byMonthBreakdown(slice, dimension, 6, calendar), dimension };
    }

    case "compare-chart":
    case "compare-table": {
      const dimension = config.compareBy ?? "item";
      const comparison = compare(slice, dimension, config.compareSubjectIds ?? [], MAX_COMPARE_SUBJECTS, calendar);
      return { kind, comparison, dimension };
    }

    case "unit-cost-chart":
    case "unit-cost-table": {
      // The same rows the Unit costs section shows, for the one item.
      const rows = perUnitRows(raw.unitCosts, slice, (itemId) => itemId === config.itemId, config.itemLabel ?? "Item");
      return { kind, rows, itemLabel: config.itemLabel ?? rows[0]?.groupName ?? "Item" };
    }

    case "stat-tile":
      return { kind, totals: totals(slice), metric: config.statMetric ?? "spend" };
  }
}

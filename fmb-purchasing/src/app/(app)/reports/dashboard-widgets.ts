/**
 * Turns a saved home-page widget config into the same computed shapes
 * Reports itself renders — one dispatcher over aggregate.ts's pure
 * functions, entered from a stored config instead of the URL, so a widget
 * can never disagree with what Reports would show for the same filters.
 */

import {
  applyFilters,
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
} from "./aggregate.ts";
import type { ReportRawData } from "./data.ts";
import type { PerUnitRow } from "./reports-view";

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
  fy: number;
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

/** The same slice Reports would build for these filters, scoped to one fiscal year. */
export function sliceFor(config: WidgetConfig, raw: ReportRawData): Slice {
  const currentIds = new Set(
    raw.allExpenses.filter((e) => raw.fyOf.get(e.id) === config.fy).map((e) => e.id)
  );
  const currentExpenses = raw.allExpenses.filter((e) => currentIds.has(e.id));
  const currentLines = raw.allLines.filter((l) => currentIds.has(l.expenseId));

  return applyFilters(currentExpenses, currentLines, {
    month: config.month,
    vendorIds: config.vendorIds,
    categoryIds: config.categoryIds,
    itemIds: config.itemIds,
  });
}

export function computeWidgetData(kind: WidgetKind, config: WidgetConfig, raw: ReportRawData): WidgetData {
  const slice = sliceFor(config, raw);

  switch (kind) {
    case "spend-over-time":
      return { kind, monthly: byMonth(slice) };

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
      return { kind, breakdown: byMonthBreakdown(slice, dimension), dimension };
    }

    case "compare-chart":
    case "compare-table": {
      const dimension = config.compareBy ?? "item";
      const comparison = compare(slice, dimension, config.compareSubjectIds ?? [], MAX_COMPARE_SUBJECTS);
      return { kind, comparison, dimension };
    }

    case "unit-cost-chart":
    case "unit-cost-table": {
      const visibleExpenseIds = new Set(slice.expenses.map((e) => e.id));
      const vendorNameByExpense = new Map(slice.expenses.map((e) => [e.id, e.vendorName]));
      const rows: PerUnitRow[] = raw.paidCosts
        .filter((c) => c.item_id === config.itemId && visibleExpenseIds.has(c.expense_id))
        .map((c) => ({
          groupName: c.item_name ?? config.itemLabel ?? "Item",
          vendorName: vendorNameByExpense.get(c.expense_id) ?? "—",
          receiptDate: c.receipt_date,
          normalizedQuantity: Number(c.base_quantity),
          normalizedUnit: c.base_unit_code,
          perUnit: Number(c.cost_per_base_unit),
        }))
        .sort((a, b) => (a.receiptDate ?? "").localeCompare(b.receiptDate ?? ""));
      return { kind, rows, itemLabel: config.itemLabel ?? rows[0]?.groupName ?? "Item" };
    }

    case "stat-tile":
      return { kind, totals: totals(slice), metric: config.statMetric ?? "spend" };
  }
}

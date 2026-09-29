import { comparisonPeriod, parsePeriod, type Period } from "@/lib/periods";
import { applyFilters, filterOptionsFor, type FilterOption, type Filters, type Slice } from "./aggregate.ts";
import { describeBasis, withStatusBasis } from "./basis.ts";
import { loadLedger } from "./ledger.ts";
import { spanOf, withinRange } from "./ledger-rows.ts";
import { queryFromSearchParams, type ReportQuery } from "./query.ts";
import { computeSpendReport, type SpendReport } from "./spend-report.ts";

/**
 * The Reports page's data, from its URL: shared by the page and by the
 * download of it (reports/export), so a file is always the page it was taken
 * from.
 */

export type SpendView = {
  query: ReportQuery;
  period: Period;
  previousRange: Period;
  options: { vendors: FilterOption[]; categories: FilterOption[]; items: FilterOption[] };
  report: SpendReport;
  basisLabel: string;
  /** Period, filters and basis in words — for print headers and downloads. */
  summary: string;
};

export async function loadSpendView(
  params: Record<string, string | string[] | undefined>,
  today: string
): Promise<SpendView> {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // `fy` is the fiscal-year parameter from before #22, still honoured for old links.
  const period = parsePeriod(one(params.period) ?? one(params.fy), today);
  const asked = queryFromSearchParams(params, period.code);
  // Like with like: a period still under way compares with the same stretch
  // of the one before, not all of it.
  const previousRange = comparisonPeriod(period, today);

  // The period before comes back in the same load, so change can be shown
  // without a second one.
  const ledger = withStatusBasis(await loadLedger(spanOf(period, previousRange)), asked.status);
  const currentLedger = withinRange(ledger, period);
  const previousLedger = withinRange(ledger, previousRange);

  const options = filterOptionsFor(currentLedger.expenses, currentLedger.lines);

  // Anything not on offer for this period is dropped rather than carried
  // silently — otherwise switching period leaves stale ids selecting nothing.
  const offered = (list: string[], from: FilterOption[]) => list.filter((v) => from.some((o) => o.value === v));
  const query: ReportQuery = {
    ...asked,
    vendors: offered(asked.vendors, options.vendors),
    categories: offered(asked.categories, options.categories),
    items: offered(asked.items, options.items),
  };

  const filters: Filters = { month: null, vendorIds: query.vendors, categoryIds: query.categories, itemIds: query.items };
  const current = applyFilters(currentLedger.expenses, currentLedger.lines, filters);
  const previous: Slice | null = previousLedger.expenses.length
    ? applyFilters(previousLedger.expenses, previousLedger.lines, filters)
    : null;

  const report = computeSpendReport({
    current,
    previous,
    unitCosts: currentLedger.unitCosts,
    query,
    periodLabel: period.label,
    previousLabel: previousRange.label,
  });

  const basisLabel = describeBasis(query.status);
  return {
    query,
    period,
    previousRange,
    options,
    report,
    basisLabel,
    summary: `${describeFilters(query, period.label, options)} · ${basisLabel}`,
  };
}

/** The period and active filters as one plain-language line. */
export function describeFilters(
  query: Pick<ReportQuery, "vendors" | "categories" | "items">,
  periodLabel: string,
  options: { vendors: FilterOption[]; categories: FilterOption[]; items: FilterOption[] }
): string {
  const labelsOf = (from: FilterOption[], ids: string[]) => ids.map((id) => from.find((o) => o.value === id)?.label ?? id);
  const parts = [periodLabel];
  const v = labelsOf(options.vendors, query.vendors);
  const c = labelsOf(options.categories, query.categories);
  const i = labelsOf(options.items, query.items);
  if (v.length > 0) parts.push(`Vendors: ${v.join(", ")}`);
  if (c.length > 0) parts.push(`Categories: ${c.join(", ")}`);
  if (i.length > 0) parts.push(`Items: ${i.join(", ")}`);
  return parts.join(" · ");
}

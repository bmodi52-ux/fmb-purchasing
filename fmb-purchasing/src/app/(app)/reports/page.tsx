import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePeriod, previousPeriod } from "@/lib/periods";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import {
  applyFilters,
  vendorKeyOf,
  categoryKeyOf,
  itemKeyOf,
  type Filters,
  type Slice,
} from "./aggregate";
import { loadReportRawData, spanOf, withinRange } from "./data";
import { ReportsView, type PerUnitRow } from "./reports-view";
import {
  SECTIONS,
  type ReportSection,
  type ReportQuery,
  type CompareDimension,
} from "./report-filters";

export const metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  // vendor, category and item repeat, so each arrives as an array when more
  // than one is selected and as a bare string when exactly one is.
  searchParams: Promise<{
    period?: string;
    /** The fiscal-year parameter from before #22, still honoured for old links. */
    fy?: string;
    section?: string;
    breakdownBy?: string;
    compareBy?: string;
    vendor?: string | string[];
    category?: string | string[];
    item?: string | string[];
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");

  const params = await searchParams;
  const today = todayIso();
  const period = parsePeriod(params.period ?? params.fy, today);
  const previousRange = previousPeriod(period, today);

  // The period before comes back in the same fetch so the dashboard can show
  // change without a second round trip — the function runs a long way from
  // the database, so each one is expensive.
  const [raw, earliest] = await Promise.all([
    loadReportRawData(spanOf(period, previousRange)),
    earliestExpenseDate(createAdminClient()),
  ]);

  const currentRaw = withinRange(raw, period);
  const previousRaw = withinRange(raw, previousRange);

  /* ---------------- filter options, drawn from the period on screen ------ */

  const vendorOptions = toSortedOptions(currentRaw.allExpenses.map(vendorKeyOf));
  const categoryOptions = toSortedOptions(
    currentRaw.allLines.filter((l) => l.categoryId).map(categoryKeyOf)
  );
  const itemOptions = toSortedOptions(currentRaw.allLines.filter((l) => l.itemId).map(itemKeyOf));

  // Anything not on offer for this period is dropped rather than carried
  // silently — otherwise switching period leaves stale ids selecting nothing.
  const asList = (v: string | string[] | undefined) =>
    v == null ? [] : Array.isArray(v) ? v : [v];

  const selectedVendors = asList(params.vendor).filter((v) =>
    vendorOptions.some((o) => o.value === v)
  );
  const selectedCategories = asList(params.category).filter((c) =>
    categoryOptions.some((o) => o.value === c)
  );
  const selectedItems = asList(params.item).filter((i) => itemOptions.some((o) => o.value === i));

  const filters: Filters = {
    month: null,
    vendorIds: selectedVendors,
    categoryIds: selectedCategories,
    itemIds: selectedItems,
  };

  const current = applyFilters(currentRaw.allExpenses, currentRaw.allLines, filters);
  const previous: Slice | null = previousRaw.allExpenses.length
    ? applyFilters(previousRaw.allExpenses, previousRaw.allLines, filters)
    : null;

  /* ---------------- per-unit trends, scoped to the same slice ------------ */

  const visibleExpenseIds = new Set(current.expenses.map((e) => e.id));
  const visibleItemIds = new Set(current.lines.map((l) => l.itemId).filter(Boolean) as string[]);
  const vendorNameByExpense = new Map(current.expenses.map((e) => [e.id, e.vendorName]));

  const perUnitRows: PerUnitRow[] = currentRaw.paidCosts
    .filter((c) => visibleExpenseIds.has(c.expense_id))
    // Only items still in the slice: a category or item filter has to narrow
    // this section too, or it would contradict everything above it.
    .filter((c) => visibleItemIds.has(c.item_id))
    .map((c) => ({
      groupName: c.item_name ?? "—",
      vendorName: vendorNameByExpense.get(c.expense_id) ?? "—",
      receiptDate: c.receipt_date ?? null,
      normalizedQuantity: Number(c.base_quantity),
      normalizedUnit: c.base_unit_code,
      perUnit: Number(c.cost_per_base_unit),
      // A loose line's pack is one unit, so its per-pack price is the per-unit one.
      perPack: c.sold_loose ? null : Number(c.line_total) / Number(c.normalized_quantity),
    }))
    .sort(
      (a, b) =>
        a.groupName.localeCompare(b.groupName) ||
        (a.receiptDate ?? "").localeCompare(b.receiptDate ?? "")
    );

  /* ---------------- average unit cost, for the Compare cards ------------- */

  // Averaged across every purchase of the item in the slice, from the same
  // view the Unit costs section reads — so a figure here and a figure there
  // can never disagree.
  const unitCostByItem = new Map<string, { average: number; unit: string }>();
  {
    const acc = new Map<string, { sum: number; n: number; unit: string }>();
    for (const c of currentRaw.paidCosts) {
      if (!visibleExpenseIds.has(c.expense_id) || !visibleItemIds.has(c.item_id)) continue;
      const entry = acc.get(c.item_id) ?? { sum: 0, n: 0, unit: c.base_unit_code };
      entry.sum += Number(c.cost_per_base_unit);
      entry.n += 1;
      acc.set(c.item_id, entry);
    }
    for (const [itemId, v] of acc) {
      unitCostByItem.set(itemId, { average: v.sum / v.n, unit: v.unit });
    }
  }

  const section = (SECTIONS.some((s) => s.key === params.section)
    ? params.section
    : "overview") as ReportSection;

  const breakdownBy = (["item", "category", "vendor"] as const).includes(
    params.breakdownBy as CompareDimension
  )
    ? (params.breakdownBy as CompareDimension)
    : "category";

  const compareBy = (["item", "category", "vendor"] as const).includes(
    params.compareBy as CompareDimension
  )
    ? (params.compareBy as CompareDimension)
    : "item";

  const query: ReportQuery = {
    period: period.code,
    section,
    vendors: selectedVendors,
    categories: selectedCategories,
    items: selectedItems,
    breakdownBy,
    compareBy,
  };

  return (
    <ReportsView
      query={query}
      today={today}
      earliest={earliest}
      vendors={vendorOptions}
      categories={categoryOptions}
      items={itemOptions}
      current={current}
      previous={previous}
      periodLabel={period.label}
      previousLabel={previousRange.label}
      perUnitRows={perUnitRows}
      unitCostByItem={Object.fromEntries(unitCostByItem)}
      hasCategoryOrItemFilter={selectedCategories.length > 0 || selectedItems.length > 0}
    />
  );
}

/** Dedupes {key, label} pairs into a sorted <select>/menu option list. */
function toSortedOptions(pairs: { key: string; label: string }[]): { value: string; label: string }[] {
  return [...new Map(pairs.map((p) => [p.key, p.label])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

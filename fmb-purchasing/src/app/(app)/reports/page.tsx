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
import { loadSavedViews } from "@/lib/saved-report-views";
import { ReportsView } from "./reports-view";
import { averageUnitCosts, perUnitRows as perUnitRowsFor } from "./unit-costs";
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
  const admin = createAdminClient();
  const [raw, earliest, savedViews, { data: teams }] = await Promise.all([
    loadReportRawData(spanOf(period, previousRange)),
    earliestExpenseDate(admin),
    loadSavedViews(admin, user),
    admin.from("teams").select("id, name").order("name"),
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

  // Only items still in the slice: a category or item filter has to narrow
  // this section too, or it would contradict everything above it.
  const visibleItemIds = new Set(current.lines.map((l) => l.itemId).filter(Boolean) as string[]);
  const keepItem = (itemId: string) => visibleItemIds.has(itemId);

  const perUnitRows = perUnitRowsFor(currentRaw.paidCosts, current, keepItem);

  // The Compare cards' average, from the same rows the Unit costs section
  // reads, so a figure here and a figure there can never disagree.
  const unitCostByItem = averageUnitCosts(currentRaw.paidCosts, current, keepItem);

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
      savedViews={savedViews}
      userId={user.id}
      teams={(teams ?? []).map((t) => ({ id: t.id as string, name: t.name as string }))}
    />
  );
}

/** Dedupes {key, label} pairs into a sorted <select>/menu option list. */
function toSortedOptions(pairs: { key: string; label: string }[]): { value: string; label: string }[] {
  return [...new Map(pairs.map((p) => [p.key, p.label])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

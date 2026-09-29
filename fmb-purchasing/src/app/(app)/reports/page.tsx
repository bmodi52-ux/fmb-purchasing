import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { comparisonPeriod, parsePeriod } from "@/lib/periods";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { applyFilters, filterOptionsFor, type Filters, type Slice } from "@/lib/reporting/aggregate";
import { describeBasis, withStatusBasis } from "@/lib/reporting/basis";
import { loadLedger } from "@/lib/reporting/ledger";
import { spanOf, withinRange } from "@/lib/reporting/ledger-rows";
import { queryFromSearchParams, type ReportQuery } from "@/lib/reporting/query";
import { loadSavedViews } from "@/lib/saved-report-views";
import { ReportsView } from "./reports-view";
import { averageUnitCosts, perUnitRows as perUnitRowsFor } from "./unit-costs";

export const metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  // vendor, category and item repeat, so each arrives as an array when more
  // than one is selected and as a bare string when exactly one is.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");

  const params = await searchParams;
  const today = todayIso();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // `fy` is the fiscal-year parameter from before #22, still honoured for old links.
  const period = parsePeriod(one(params.period) ?? one(params.fy), today);
  const asked = queryFromSearchParams(params, period.code);
  // Like with like: a period still under way compares with the same stretch
  // of the one before, not all of it.
  const previousRange = comparisonPeriod(period, today);

  // The period before comes back in the same load so the page can show
  // change without a second one.
  const admin = createAdminClient();
  const [ledger, earliest, savedViews, { data: teams }] = await Promise.all([
    loadLedger(spanOf(period, previousRange)).then((l) => withStatusBasis(l, asked.status)),
    earliestExpenseDate(admin),
    loadSavedViews(admin, user),
    admin.from("teams").select("id, name").order("name"),
  ]);

  const currentLedger = withinRange(ledger, period);
  const previousLedger = withinRange(ledger, previousRange);

  /* ---------------- filter options, drawn from the period on screen ------ */

  const options = filterOptionsFor(currentLedger.expenses, currentLedger.lines);

  // Anything not on offer for this period is dropped rather than carried
  // silently — otherwise switching period leaves stale ids selecting nothing.
  const offered = (list: string[], from: { value: string }[]) => list.filter((v) => from.some((o) => o.value === v));
  const query: ReportQuery = {
    ...asked,
    vendors: offered(asked.vendors, options.vendors),
    categories: offered(asked.categories, options.categories),
    items: offered(asked.items, options.items),
  };

  const filters: Filters = {
    month: null,
    vendorIds: query.vendors,
    categoryIds: query.categories,
    itemIds: query.items,
  };

  const current = applyFilters(currentLedger.expenses, currentLedger.lines, filters);
  const previous: Slice | null = previousLedger.expenses.length
    ? applyFilters(previousLedger.expenses, previousLedger.lines, filters)
    : null;

  /* ---------------- per-unit trends, scoped to the same slice ------------ */

  // Only items still in the slice: a category or item filter has to narrow
  // this section too, or it would contradict everything above it.
  const visibleItemIds = new Set(current.lines.map((l) => l.itemId).filter(Boolean) as string[]);
  const keepItem = (itemId: string) => visibleItemIds.has(itemId);

  const perUnitRows = perUnitRowsFor(currentLedger.unitCosts, current, keepItem);

  // The Compare cards' average, from the same rows the Unit costs section
  // reads, so a figure here and a figure there can never disagree.
  const unitCostByItem = averageUnitCosts(currentLedger.unitCosts, current, keepItem);

  return (
    <ReportsView
      query={query}
      basisLabel={describeBasis(query.status)}
      today={today}
      earliest={earliest}
      vendors={options.vendors}
      categories={options.categories}
      items={options.items}
      current={current}
      previous={previous}
      periodLabel={period.label}
      previousLabel={previousRange.label}
      perUnitRows={perUnitRows}
      unitCostByItem={Object.fromEntries(unitCostByItem)}
      hasCategoryOrItemFilter={query.categories.length > 0 || query.items.length > 0}
      savedViews={savedViews}
      userId={user.id}
      teams={(teams ?? []).map((t) => ({ id: t.id as string, name: t.name as string }))}
    />
  );
}

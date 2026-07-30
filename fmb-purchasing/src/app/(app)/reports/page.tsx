import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { fiscalYearHijri, formatFiscalYear } from "@/lib/fiscal-year";
import { categoryLabelsById } from "@/lib/categories";
import {
  applyFilters,
  monthKey,
  expenseDate,
  formatMonthLabel,
  type ExpenseRecord,
  type LineRecord,
  type Filters,
  type Slice,
} from "./aggregate";
import { ReportsView, type PerUnitRow } from "./reports-view";
import {
  SECTIONS,
  type ReportSection,
  type ReportQuery,
  type CompareDimension,
} from "./report-filters";

export default async function ReportsPage({
  searchParams,
}: {
  // vendor, category and item repeat, so each arrives as an array when more
  // than one is selected and as a bare string when exactly one is.
  searchParams: Promise<{
    fy?: string;
    section?: string;
    month?: string;
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
  const currentFy = fiscalYearHijri(new Date());
  const selectedFy = params.fy ? Number(params.fy) : currentFy;

  const admin = createAdminClient();

  // The previous year comes back in the same query so the dashboard can show
  // change without a second round trip — the function runs a long way from
  // the database, so each one is expensive.
  const [{ data: rawExpenses }, { data: fyRows }, { data: categoryRows }, { data: vendorRows }] =
    await Promise.all([
      admin
        .from("expenses")
        .select(
          "id, expense_number, vendor_id, vendor_name_raw, status, receipt_date, created_at, total, gst_amount, fiscal_year_hijri"
        )
        .in("fiscal_year_hijri", [selectedFy, selectedFy - 1])
        .neq("status", "declined"),
      admin.from("expense_fiscal_years").select("fiscal_year_hijri"),
      admin.from("categories").select("id, name, parent_category_id"),
      admin.from("vendors").select("id, name"),
    ]);

  const expenseIds = (rawExpenses ?? []).map((e) => e.id);

  const [{ data: rawLines }, { data: paidCosts }] = expenseIds.length
    ? await Promise.all([
        // The item name is three tables up from a line — line → offer → pack
        // size → item — so it rides along as a nested embed rather than
        // costing another wave of queries.
        admin
          .from("expense_line_items")
          .select(
            "expense_id, category_id, line_total, quantity, description_raw, pricelist_item_id, pricelist_items ( item_pack_sizes ( items ( id, name ) ) )"
          )
          .in("expense_id", expenseIds),
        admin
          .from("item_paid_unit_costs")
          .select("item_id, item_name, expense_id, receipt_date, base_quantity, base_unit_code, cost_per_base_unit")
          .in("expense_id", expenseIds),
      ])
    : [{ data: [] }, { data: [] }];

  const categoryNameById = categoryLabelsById(categoryRows ?? []);
  const vendorNameById = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));

  const allExpenses: ExpenseRecord[] = (rawExpenses ?? []).map((e) => ({
    id: e.id,
    expenseNumber: e.expense_number,
    vendorId: e.vendor_id,
    vendorName:
      (e.vendor_id ? vendorNameById.get(e.vendor_id) : null) ?? e.vendor_name_raw ?? "Unrecorded vendor",
    status: e.status,
    receiptDate: e.receipt_date,
    createdAt: e.created_at,
    total: Number(e.total),
    gst: Number(e.gst_amount),
  }));

  const fyOf = new Map((rawExpenses ?? []).map((e) => [e.id, e.fiscal_year_hijri]));

  const allLines: LineRecord[] = (rawLines ?? []).map((l) => {
    const offer = l.pricelist_items as unknown as
      | { item_pack_sizes: { items: { id: string; name: string } | null } | null }
      | null;
    const item = offer?.item_pack_sizes?.items ?? null;
    return {
      expenseId: l.expense_id,
      categoryId: l.category_id,
      categoryName: l.category_id
        ? (categoryNameById.get(l.category_id) ?? "Uncategorised")
        : "Uncategorised",
      itemId: item?.id ?? null,
      // Falls back to what the receipt said, so an unmatched line still shows
      // up under a name a person recognises rather than vanishing.
      itemName: item?.name ?? l.description_raw,
      lineTotal: Number(l.line_total),
      quantity: l.quantity == null ? null : Number(l.quantity),
    };
  });

  const currentExpenses = allExpenses.filter((e) => fyOf.get(e.id) === selectedFy);
  const previousExpenses = allExpenses.filter((e) => fyOf.get(e.id) === selectedFy - 1);

  /* ---------------- filter options, drawn from the year on screen -------- */

  const monthsInYear = [...new Set(currentExpenses.map((e) => monthKey(expenseDate(e))))].sort();

  // A month is only honoured if it belongs to the selected year — otherwise
  // switching year while a month is chosen would silently show nothing.
  const selectedMonth = params.month && monthsInYear.includes(params.month) ? params.month : "";

  const currentIds = new Set(currentExpenses.map((e) => e.id));
  const currentLines = allLines.filter((l) => currentIds.has(l.expenseId));

  const vendorOptions = [
    ...new Map(
      currentExpenses.map((e) => [e.vendorId ?? `raw:${e.vendorName}`, e.vendorName])
    ).entries(),
  ]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const categoryOptions = [
    ...new Map(
      currentLines.filter((l) => l.categoryId).map((l) => [l.categoryId!, l.categoryName])
    ).entries(),
  ]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const itemOptions = [
    ...new Map(currentLines.filter((l) => l.itemId).map((l) => [l.itemId!, l.itemName])).entries(),
  ]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Anything not on offer for this year is dropped rather than carried
  // silently — otherwise switching year leaves stale ids selecting nothing.
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
    month: selectedMonth || null,
    vendorIds: selectedVendors,
    categoryIds: selectedCategories,
    itemIds: selectedItems,
  };

  const current = applyFilters(currentExpenses, currentLines, filters);

  /* ---------------- what "before" means for the comparison --------------- */

  const previousIds = new Set(previousExpenses.map((e) => e.id));
  const previousLines = allLines.filter((l) => previousIds.has(l.expenseId));

  let previous: Slice | null;
  let previousLabel: string;

  if (selectedMonth) {
    // Month selected: compare against the previous month with data in it,
    // staying inside what has already been fetched.
    const idx = monthsInYear.indexOf(selectedMonth);
    const priorMonth = idx > 0 ? monthsInYear[idx - 1] : null;
    previous = priorMonth
      ? applyFilters(currentExpenses, currentLines, { ...filters, month: priorMonth })
      : null;
    previousLabel = priorMonth ? formatMonthLabel(priorMonth) : "";
  } else {
    previous = previousExpenses.length
      ? applyFilters(previousExpenses, previousLines, { ...filters, month: null })
      : null;
    previousLabel = formatFiscalYear(selectedFy - 1);
  }

  /* ---------------- per-unit trends, scoped to the same slice ------------ */

  const visibleExpenseIds = new Set(current.expenses.map((e) => e.id));
  const visibleItemIds = new Set(current.lines.map((l) => l.itemId).filter(Boolean) as string[]);
  const vendorNameByExpense = new Map(current.expenses.map((e) => [e.id, e.vendorName]));

  const perUnitRows: PerUnitRow[] = (paidCosts ?? [])
    .filter((c) => visibleExpenseIds.has(c.expense_id as string))
    // Only items still in the slice: a category or item filter has to narrow
    // this section too, or it would contradict everything above it.
    .filter((c) => visibleItemIds.has(c.item_id as string))
    .map((c) => ({
      groupName: (c.item_name as string) ?? "—",
      vendorName: vendorNameByExpense.get(c.expense_id as string) ?? "—",
      receiptDate: (c.receipt_date as string | null) ?? null,
      normalizedQuantity: Number(c.base_quantity),
      normalizedUnit: c.base_unit_code as string,
      perUnit: Number(c.cost_per_base_unit),
    }))
    .sort(
      (a, b) =>
        a.groupName.localeCompare(b.groupName) ||
        (a.receiptDate ?? "").localeCompare(b.receiptDate ?? "")
    );

  const fiscalYears = [...new Set((fyRows ?? []).map((r) => r.fiscal_year_hijri))].sort(
    (a, b) => b - a
  );
  if (!fiscalYears.includes(currentFy)) fiscalYears.unshift(currentFy);

  /* ---------------- average unit cost, for the Compare cards ------------- */

  // Averaged across every purchase of the item in the slice, from the same
  // view the Unit costs section reads — so a figure here and a figure there
  // can never disagree.
  const unitCostByItem = new Map<string, { average: number; unit: string }>();
  {
    const acc = new Map<string, { sum: number; n: number; unit: string }>();
    for (const c of paidCosts ?? []) {
      const itemId = c.item_id as string;
      if (!visibleExpenseIds.has(c.expense_id as string) || !visibleItemIds.has(itemId)) continue;
      const entry = acc.get(itemId) ?? { sum: 0, n: 0, unit: c.base_unit_code as string };
      entry.sum += Number(c.cost_per_base_unit);
      entry.n += 1;
      acc.set(itemId, entry);
    }
    for (const [itemId, v] of acc) {
      unitCostByItem.set(itemId, { average: v.sum / v.n, unit: v.unit });
    }
  }

  const fiscalYearsList = fiscalYears;
  const periodLabel = selectedMonth ? formatMonthLabel(selectedMonth) : formatFiscalYear(selectedFy);

  const section = (SECTIONS.some((s) => s.key === params.section)
    ? params.section
    : "overview") as ReportSection;

  const compareBy = (["item", "category", "vendor"] as const).includes(
    params.compareBy as CompareDimension
  )
    ? (params.compareBy as CompareDimension)
    : "item";

  const query: ReportQuery = {
    fy: selectedFy,
    section,
    month: selectedMonth,
    vendors: selectedVendors,
    categories: selectedCategories,
    items: selectedItems,
    compareBy,
  };

  return (
    <ReportsView
      query={query}
      fiscalYears={fiscalYearsList}
      currentFy={currentFy}
      months={monthsInYear}
      vendors={vendorOptions}
      categories={categoryOptions}
      items={itemOptions}
      current={current}
      previous={previous}
      periodLabel={periodLabel}
      previousLabel={previousLabel}
      perUnitRows={perUnitRows}
      unitCostByItem={Object.fromEntries(unitCostByItem)}
      hasCategoryOrItemFilter={selectedCategories.length > 0 || selectedItems.length > 0}
    />
  );
}

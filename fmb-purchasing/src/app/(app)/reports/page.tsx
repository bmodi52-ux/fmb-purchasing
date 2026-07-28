import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { fiscalYearHijri } from "@/lib/fiscal-year";
import { ReportsView, type CategorySpend, type VendorSpend, type PerUnitRow } from "./reports-view";
import { FiscalYearSelect } from "./fiscal-year-select";
import { categoryLabelsById } from "@/lib/categories";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");

  const admin = createAdminClient();
  const currentFy = fiscalYearHijri(new Date());

  // The function runs a long way from the database, so each round trip is
  // expensive. Everything that doesn't depend on another query's result is
  // issued together; only the line-item lookups genuinely have to wait (they
  // need the expense ids). Two round trips instead of seven.
  const { fy } = await searchParams;
  const selectedFy = fy ? Number(fy) : currentFy;

  const [{ data: fyRows }, { data: categories }, { data: expenses }, { data: statusRows }] = await Promise.all([
    admin.from("expense_fiscal_years").select("fiscal_year_hijri"),
    admin.from("categories").select("id, name, parent_category_id"),
    admin
      .from("expenses")
      .select("id, vendor_name_raw, subtotal, gst_amount, total, status, receipt_date")
      .eq("fiscal_year_hijri", selectedFy)
      .neq("status", "declined"),
    admin.from("expenses").select("status").eq("fiscal_year_hijri", selectedFy),
  ]);

  const fiscalYears = [...new Set((fyRows ?? []).map((r) => r.fiscal_year_hijri))].sort((a, b) => b - a);
  if (!fiscalYears.includes(currentFy)) fiscalYears.unshift(currentFy);

  const statusCounts = { submitted: 0, approved: 0, paid: 0, declined: 0 };
  for (const r of statusRows ?? []) {
    if (r.status in statusCounts) statusCounts[r.status as keyof typeof statusCounts] += 1;
  }

  const categoryNameById = categoryLabelsById(categories ?? []);

  const expenseIds = (expenses ?? []).map((e) => e.id);
  const [{ data: lineItems }, { data: paidCosts }] = expenseIds.length
    ? await Promise.all([
        admin
          .from("expense_line_items")
          .select("expense_id, category_id, line_total, description_raw, normalized_quantity, normalized_unit, pricelist_item_id")
          .in("expense_id", expenseIds),
        // item_name comes from the view (0013), so there's no follow-up
        // query to resolve item ids into names.
        admin
          .from("item_paid_unit_costs")
          .select("item_id, item_name, expense_id, receipt_date, base_quantity, base_unit_code, cost_per_base_unit")
          .in("expense_id", expenseIds),
      ])
    : [{ data: [] }, { data: [] }];

  // Spend by category
  const categoryTotals = new Map<string, { total: number; count: number }>();
  for (const li of lineItems ?? []) {
    const name = li.category_id ? (categoryNameById.get(li.category_id) ?? "Uncategorized") : "Uncategorized";
    const entry = categoryTotals.get(name) ?? { total: 0, count: 0 };
    entry.total += li.line_total;
    entry.count += 1;
    categoryTotals.set(name, entry);
  }
  const categorySpend: CategorySpend[] = [...categoryTotals.entries()]
    .map(([categoryName, v]) => ({ categoryName, ...v }))
    .sort((a, b) => b.total - a.total);

  // Spend by vendor
  const vendorTotals = new Map<string, { total: number; count: number }>();
  for (const e of expenses ?? []) {
    const name = e.vendor_name_raw ?? "—";
    const entry = vendorTotals.get(name) ?? { total: 0, count: 0 };
    entry.total += e.total;
    entry.count += 1;
    vendorTotals.set(name, entry);
  }
  const vendorSpend: VendorSpend[] = [...vendorTotals.entries()]
    .map(([vendorName, v]) => ({ vendorName, ...v }))
    .sort((a, b) => b.total - a.total);

  // Per-unit cost trends, from the shared item_paid_unit_costs view (0010) so
  // this page and the future Thaali cost calculator use one definition of
  // "what we paid per unit" rather than each deriving their own.
  const expenseById = new Map((expenses ?? []).map((e) => [e.id, e]));

  const perUnitRows: PerUnitRow[] = (paidCosts ?? [])
    .map((c) => {
      const expense = expenseById.get(c.expense_id as string);
      return {
        groupName: (c.item_name as string) ?? "—",
        vendorName: expense?.vendor_name_raw ?? "—",
        receiptDate: (c.receipt_date as string | null) ?? null,
        normalizedQuantity: Number(c.base_quantity),
        normalizedUnit: c.base_unit_code as string,
        perUnit: Number(c.cost_per_base_unit),
      };
    })
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || (a.receiptDate ?? "").localeCompare(b.receiptDate ?? ""));

  const totalSpend = (expenses ?? []).reduce((s, e) => s + e.total, 0);
  const totalGst = (expenses ?? []).reduce((s, e) => s + e.gst_amount, 0);
  const expenseCount = (expenses ?? []).length;
  const averageExpense = expenseCount > 0 ? totalSpend / expenseCount : 0;
  const outstanding = (expenses ?? []).filter((e) => e.status === "approved").reduce((s, e) => s + e.total, 0);

  // Spend over time — monthly buckets across the fiscal year
  const monthTotals = new Map<string, number>();
  for (const e of expenses ?? []) {
    if (!e.receipt_date) continue;
    const month = e.receipt_date.slice(0, 7); // "YYYY-MM"
    monthTotals.set(month, (monthTotals.get(month) ?? 0) + e.total);
  }
  const spendOverTime = [...monthTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({ x: month, y: total }));

  const statusBreakdown = [
    { label: "Submitted", value: statusCounts.submitted },
    { label: "Approved", value: statusCounts.approved },
    { label: "Paid", value: statusCounts.paid },
    { label: "Declined", value: statusCounts.declined },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-ink">Reports</h1>
          <p className="mt-1 text-ink/70">
            Fiscal year runs Shawwal → the following Ramadan on the Fatimi/Misri Hijri calendar (§8).
          </p>
        </div>
        <FiscalYearSelect fiscalYears={fiscalYears} selectedFy={selectedFy} currentFy={currentFy} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Total spend" value={`$${totalSpend.toFixed(2)}`} />
        <MetricCard label="Total GST" value={`$${totalGst.toFixed(2)}`} />
        <MetricCard label="Expenses" value={String(expenseCount)} />
        <MetricCard label="Average expense" value={`$${averageExpense.toFixed(2)}`} />
        <MetricCard label="Outstanding (unpaid)" value={`$${outstanding.toFixed(2)}`} />
      </div>

      <ReportsView
        categorySpend={categorySpend}
        vendorSpend={vendorSpend}
        perUnitRows={perUnitRows}
        spendOverTime={spendOverTime}
        statusBreakdown={statusBreakdown}
      />
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/60 p-4">
      <p className="text-xs uppercase tracking-wide text-ink/50">{label}</p>
      <p className="mt-1 font-mono text-2xl text-ink">{value}</p>
    </div>
  );
}

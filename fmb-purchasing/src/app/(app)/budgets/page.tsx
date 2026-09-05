import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { leafCategories, categoryLabelsById } from "@/lib/categories";
import { currentFiscalYearHijri, formatFiscalYear } from "@/lib/fiscal-year";
import { FiscalYearSelect } from "@/components/fiscal-year-select";
import { SubmitButton } from "@/components/submit-button";
import { loadReportRawData } from "../reports/data";
import { setCategoryBudget, copyBudgetsFromPreviousYear } from "./actions";

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/**
 * Budget against actual, per category, for one Hijri fiscal year.
 *
 * The spec has asked for this since the beginning (§10) and nothing in the
 * schema had touched it. Deliberately the smallest thing that answers the
 * question people actually ask — "are we over on meat this year?" — rather
 * than a planning module: one amount per leaf category per year, no monthly
 * phasing, no approval lifecycle.
 *
 * Actuals come from the same cached ledger the Reports page reads, so a figure
 * here and a figure there can never disagree.
 */
export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "budgets", "view");

  const permissions = await getUserPermissions(user.teamIds);
  const canEdit = can(permissions, "budgets", "edit_master_data");

  const { fy } = await searchParams;
  const currentFy = currentFiscalYearHijri();
  const selectedFy = fy ? Number(fy) : currentFy;

  const admin = createAdminClient();
  const [{ data: categoryRows }, { data: budgetRows }, { data: fyRows }, report] = await Promise.all([
    admin.from("categories").select("id, name, parent_category_id").order("sort_order"),
    admin.from("category_budgets").select("category_id, amount").eq("fiscal_year_hijri", selectedFy),
    admin.from("expense_fiscal_years").select("fiscal_year_hijri"),
    loadReportRawData([selectedFy]),
  ]);

  const categories = leafCategories(categoryRows ?? []);
  const labels = categoryLabelsById(categoryRows ?? []);
  const budgetByCategory = new Map((budgetRows ?? []).map((b) => [b.category_id as string, Number(b.amount)]));

  // Actual spend, from the same line-level ledger Reports aggregates. Declined
  // expenses are already excluded upstream.
  const idsThisYear = new Set(
    report.allExpenses.filter((e) => report.fyOf.get(e.id) === selectedFy).map((e) => e.id)
  );
  const spentByCategory = new Map<string, number>();
  for (const line of report.allLines) {
    if (!line.categoryId || !idsThisYear.has(line.expenseId)) continue;
    spentByCategory.set(line.categoryId, (spentByCategory.get(line.categoryId) ?? 0) + line.lineTotal);
  }

  const rows = categories
    .map((c) => {
      const budget = budgetByCategory.get(c.id) ?? null;
      const spent = spentByCategory.get(c.id) ?? 0;
      return {
        id: c.id,
        label: labels.get(c.id) ?? c.name,
        budget,
        spent,
        // Null when nothing is budgeted: a category with no budget is not
        // "100% over", it is undecided, and reporting it as a breach would
        // train people to ignore the column.
        usedPct: budget && budget > 0 ? spent / budget : null,
      };
    })
    .sort((a, b) => (b.usedPct ?? -1) - (a.usedPct ?? -1) || b.spent - a.spent);

  const totalBudget = rows.reduce((s, r) => s + (r.budget ?? 0), 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0);

  const fiscalYears = [...new Set((fyRows ?? []).map((r) => r.fiscal_year_hijri))].sort((a, b) => b - a);
  if (!fiscalYears.includes(currentFy)) fiscalYears.unshift(currentFy);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title text-ink">Budgets</h1>
          <p className="page-description mt-1 max-w-xl">
            What was set aside for {formatFiscalYear(selectedFy)}, against what has been spent.
            Amounts are GST-inclusive, the same as the totals on every receipt.
          </p>
        </div>
        <FiscalYearSelect fiscalYears={fiscalYears} selectedFy={selectedFy} currentFy={currentFy} />
      </div>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-xl border border-ink/10 bg-white/60 px-5 py-4">
        <Figure label="Budgeted" value={totalBudget > 0 ? money(totalBudget) : "Not set"} />
        <Figure label="Spent" value={money(totalSpent)} />
        <Figure
          label="Remaining"
          value={totalBudget > 0 ? money(totalBudget - totalSpent) : "—"}
          tone={totalBudget > 0 && totalSpent > totalBudget ? "over" : "normal"}
        />
      </div>

      {canEdit && totalBudget === 0 && (
        <form action={copyBudgetsFromPreviousYear}>
          <input type="hidden" name="fiscal_year" value={selectedFy} />
          <SubmitButton className="rounded-md border border-ink/15 px-3.5 py-2 text-sm text-ink/70 hover:border-ink/30">
            Start from {formatFiscalYear(selectedFy - 1)}&rsquo;s budgets
          </SubmitButton>
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-ink/10">
        <table className="min-w-full text-sm">
          <caption className="sr-only">
            Budget against actual spend by category for {formatFiscalYear(selectedFy)}
          </caption>
          <thead className="border-b border-ink/10 bg-ink/[0.03] text-left text-xs text-ink/55">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Category</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Budget</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Spent</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Remaining</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Used</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const over = row.usedPct !== null && row.usedPct > 1;
              return (
                <tr key={row.id} className="border-b border-ink/5 last:border-b-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-normal text-ink">
                    {row.label}
                  </th>
                  <td className="px-4 py-2.5 text-right">
                    {canEdit ? (
                      <form action={setCategoryBudget} className="flex justify-end">
                        <input type="hidden" name="category_id" value={row.id} />
                        <input type="hidden" name="fiscal_year" value={selectedFy} />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          name="amount"
                          defaultValue={row.budget ?? ""}
                          placeholder="—"
                          aria-label={`Budget for ${row.label}`}
                          className="w-28 rounded border border-ink/15 bg-white px-2 py-1 text-right font-mono"
                        />
                        {/* Enter saves the row, which is how someone setting
                            eighteen of these in one sitting will work. The
                            button exists so the form is submittable without a
                            keyboard and so the action has an accessible name;
                            it is not the intended route. */}
                        <SubmitButton className="sr-only">Save {row.label} budget</SubmitButton>
                      </form>
                    ) : (
                      <span className="font-mono text-ink/70">
                        {row.budget === null ? "—" : money(row.budget)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-figures text-ink/80">
                    {money(row.spent)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-mono tabular-figures ${
                      over ? "text-maroon" : "text-ink/80"
                    }`}
                  >
                    {row.budget === null ? "—" : money(row.budget - row.spent)}
                  </td>
                  <td className="px-4 py-2.5">
                    <UsageBar pct={row.usedPct} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "over";
}) {
  return (
    <div>
      <p className="text-xs text-ink/55">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-figures ${tone === "over" ? "text-maroon" : "text-ink"}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * Proportion of a budget used.
 *
 * No red until it is actually over. Spending 90% of a budget nine months into
 * the year is exactly what a budget is for, and colouring it as a warning
 * teaches people that the colour means nothing.
 */
function UsageBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-ink/35">no budget set</span>;

  const over = pct > 1;
  const width = Math.min(100, Math.round(pct * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
        <div
          className={`h-full rounded-full ${over ? "bg-maroon" : "bg-gold-deep"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className={`font-mono text-xs ${over ? "text-maroon" : "text-ink/55"}`}>
        {Math.round(pct * 100)}%
      </span>
    </div>
  );
}

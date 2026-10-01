import { MEASURES } from "./measures.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { categoryLabelsById, leafCategories, sortCategories } from "@/lib/categories";
import { budgetsForPeriod, loadBudgets, type CategoryPeriodBudget, type StoredBudget } from "@/lib/budgets";
import { budgetActuals, budgetByMonth, budgetTotals, type BudgetMonth, type BudgetTotals } from "@/lib/budget-actuals";
import { monthCalendarFor, monthSpans, type Period } from "@/lib/periods";
import { loadLedger } from "./ledger.ts";
import type { DateRange } from "./ledger-rows.ts";
import type { ReportTable } from "./tables.ts";

/**
 * Budget against actual for a period (#39) — shared by the Budgets page and
 * its download, so the file is always the page.
 *
 * Actuals come from the ledger every report reads, counting everything live
 * (submitted, approved or paid), because a budget is used up as soon as the
 * money is promised, not when the transfer happens.
 */

export type BudgetRow = {
  id: string;
  label: string;
  budget: number | null;
  share: CategoryPeriodBudget | undefined;
  spent: number;
  paid: number;
  committed: number;
  /**
   * Null when nothing is budgeted: a category with no budget is not "100%
   * over", it is undecided, and reporting it as a breach would train people
   * to ignore the column.
   */
  usedPct: number | null;
};

export type BudgetView = {
  rows: BudgetRow[];
  totals: BudgetTotals;
  /** Every budget, for "Start from last period's budgets". */
  budgets: StoredBudget[];
  /**
   * Spend no budget row holds, stated rather than left out, so Budgets never
   * disagrees with Reports by an amount nobody can account for. On a parent
   * category: filed against "Meat & Poultry" itself rather than one of its
   * subcategories, where budgets are set.
   */
  onParentCategories: { categoryId: string; label: string; amount: number }[];
  /** Surcharges, delivery and rounding carry no category by design; so does a line nobody has classified. */
  uncategorised: number;
  /**
   * The budgeted categories a month at a time, in the period's own calendar
   * — Shawwal to Ramadan for a Hijri year — with each month's budget from
   * its phasing. Empty when nothing is budgeted.
   */
  months: BudgetMonth[];
};

export async function loadBudgetView(
  admin: SupabaseClient,
  period: DateRange & Pick<Period, "calendar" | "code">
): Promise<BudgetView> {
  const [{ data: categoryRows }, budgets, ledger] = await Promise.all([
    admin.from("categories").select("id, name, parent_category_id").order("sort_order"),
    loadBudgets(admin),
    loadLedger(period),
  ]);

  const labels = categoryLabelsById(categoryRows ?? []);
  const perCategory = budgetsForPeriod(budgets, period.start, period.end);
  const actuals = budgetActuals(ledger.lines, new Map(ledger.expenses.map((e) => [e.id, e.status])), categoryRows ?? []);

  const rows: BudgetRow[] = leafCategories(sortCategories(categoryRows ?? []))
    .map((c) => {
      const share = perCategory.get(c.id);
      const budget = share && share.uncoveredDays < share.days ? share.amount : null;
      const { spent, paid } = actuals.byLeaf.get(c.id) ?? { spent: 0, paid: 0 };
      return {
        id: c.id,
        label: labels.get(c.id) ?? c.name,
        budget,
        share,
        spent,
        paid,
        committed: Math.round((spent - paid) * 100) / 100,
        usedPct: budget && budget > 0 ? spent / budget : null,
      };
    })
    .sort((a, b) => (b.usedPct ?? -1) - (a.usedPct ?? -1) || b.spent - a.spent);

  const budgeted = new Set(rows.filter((r) => r.budget !== null).map((r) => r.id));
  const dateOf = new Map(ledger.expenses.map((e) => [e.id, e.reportDate]));
  const months = budgeted.size
    ? budgetByMonth(
        monthSpans(period, monthCalendarFor(period)),
        (start, end) => {
          const inMonth = budgetsForPeriod(budgets, start, end);
          return [...budgeted].reduce((sum, id) => sum + (inMonth.get(id)?.amount ?? 0), 0);
        },
        ledger.lines.map((l) => ({ date: dateOf.get(l.expenseId) ?? "", categoryId: l.categoryId, lineTotal: l.lineTotal })),
        budgeted
      )
    : [];

  return {
    rows,
    totals: budgetTotals(rows),
    budgets,
    onParentCategories: actuals.onParentCategories.map((p) => ({ ...p, label: labels.get(p.categoryId) ?? "A category" })),
    uncategorised: actuals.uncategorised,
    months,
  };
}

/**
 * The page as a table: a row per category, then the spend no budget holds,
 * so the Spent column adds up to what Reports calls total spend.
 */
export function budgetTables(view: BudgetView): ReportTable[] {
  const extra = [
    ...view.onParentCategories.map((p) => ({ label: `${p.label} (the category itself, not a subcategory)`, spent: p.amount })),
    ...(view.uncategorised !== 0 ? [{ label: "Not in any category", spent: view.uncategorised }] : []),
  ];
  const totalSpent = Math.round(
    (view.rows.reduce((s, r) => s + r.spent, 0) + extra.reduce((s, r) => s + r.spent, 0)) * 100
  ) / 100;

  return [
    {
      title: "Budget against actual",
      columns: [
        { key: "label", label: "Category", kind: "text" },
        { key: "budget", label: "Budget", kind: "money" },
        { key: "paid", label: MEASURES.paid.label, kind: "money" },
        { key: "committed", label: MEASURES.committed.label, kind: "money" },
        { key: "spent", label: "Spent", kind: "money" },
        { key: "remaining", label: "Remaining", kind: "money" },
        { key: "used", label: "Used", kind: "percent" },
      ],
      rows: [
        ...view.rows.map((r) => ({
          label: r.label,
          budget: r.budget,
          paid: r.paid,
          committed: r.committed,
          spent: r.spent,
          remaining: r.budget === null ? null : Math.round((r.budget - r.spent) * 100) / 100,
          used: r.usedPct,
        })),
        ...extra.map((e) => ({ label: e.label, budget: null, paid: null, committed: null, spent: e.spent, remaining: null, used: null })),
      ],
      totals: {
        label: "Total",
        budget: view.totals.remaining !== null ? view.totals.budgeted : null,
        paid: view.totals.paid,
        committed: view.totals.committed,
        spent: totalSpent,
        // Budgets less what the budgeted categories spent — see budgetTotals.
        remaining: view.totals.remaining,
        used: null,
      },
    },
    ...(view.months.length
      ? [
          {
            title: "By month",
            columns: [
              { key: "label", label: "Month", kind: "text" as const },
              { key: "budget", label: "Budget", kind: "money" as const },
              { key: "spent", label: "Spent", kind: "money" as const },
              { key: "difference", label: "Left over", kind: "money" as const },
              { key: "cumulativeBudget", label: "Budget to date", kind: "money" as const },
              { key: "cumulativeSpent", label: "Spent to date", kind: "money" as const },
            ],
            rows: view.months.map((m) => ({
              label: m.label,
              budget: m.budget,
              spent: m.spent,
              difference: Math.round((m.budget - m.spent) * 100) / 100,
              cumulativeBudget: m.cumulativeBudget,
              cumulativeSpent: m.cumulativeSpent,
            })),
          },
        ]
      : []),
  ];
}

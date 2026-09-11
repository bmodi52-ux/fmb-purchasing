import type { SupabaseClient } from "@supabase/supabase-js";
import { allocate, budgetForPeriod, type BudgetRecord, type PeriodBudget } from "@/lib/budget-allocation";

/**
 * Reading budgets for a period (#22) — the database half of
 * budget-allocation.ts.
 */

export type StoredBudget = BudgetRecord & { categoryId: string; periodCode: string };

type BudgetRow = {
  id: string;
  category_id: string;
  start_date: string;
  end_date: string;
  period_code: string;
  label: string;
  amount: number;
  priority: number;
};

export async function loadBudgets(admin: SupabaseClient, categoryIds?: string[]): Promise<StoredBudget[]> {
  let query = admin
    .from("category_budgets")
    .select("id, category_id, start_date, end_date, period_code, label, amount, priority")
    .order("start_date");
  if (categoryIds) query = query.in("category_id", categoryIds);
  const { data } = await query;
  return ((data ?? []) as BudgetRow[]).map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    start: r.start_date,
    end: r.end_date,
    periodCode: r.period_code,
    label: r.label,
    amount: Number(r.amount),
    priority: r.priority,
  }));
}

export type CategoryPeriodBudget = PeriodBudget & {
  /** The budget set for exactly this period, when there is one. */
  exact: StoredBudget | null;
};

/** Each category's budget for a period, from all of its budgets. */
export function budgetsForPeriod(
  budgets: StoredBudget[],
  start: string,
  end: string
): Map<string, CategoryPeriodBudget> {
  const byCategory = new Map<string, StoredBudget[]>();
  for (const b of budgets) byCategory.set(b.categoryId, [...(byCategory.get(b.categoryId) ?? []), b]);

  const out = new Map<string, CategoryPeriodBudget>();
  for (const [categoryId, list] of byCategory) {
    const relevant = list;
    const share = budgetForPeriod(allocate(relevant), relevant, start, end);
    out.set(categoryId, {
      ...share,
      exact: list.find((b) => b.start === start && b.end === end) ?? null,
    });
  }
  return out;
}

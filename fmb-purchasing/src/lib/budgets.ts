import type { SupabaseClient } from "@supabase/supabase-js";
import { allocate, budgetForPeriod, type BudgetRecord, type PeriodBudget } from "@/lib/budget-allocation";
import { monthOf, parsePeriod } from "@/lib/periods";

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
  const rows = (data ?? []) as BudgetRow[];

  // Monthly phasing (#39, 0052). Missing before that migration has run, when
  // every budget simply spreads evenly.
  const { data: phasing } = rows.length
    ? await admin.from("category_budget_phasing").select("budget_id, month_index, percent").in("budget_id", rows.map((r) => r.id))
    : { data: [] };
  const percentsOf = new Map<string, Map<number, number>>();
  for (const p of phasing ?? []) {
    const map = percentsOf.get(p.budget_id as string) ?? new Map<number, number>();
    map.set(p.month_index as number, Number(p.percent));
    percentsOf.set(p.budget_id as string, map);
  }

  return rows.map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    start: r.start_date,
    end: r.end_date,
    periodCode: r.period_code,
    label: r.label,
    amount: Number(r.amount),
    priority: r.priority,
    months: monthsFor(r.period_code, percentsOf.get(r.id)),
  }));
}

/** A whole year's twelve months with their percentages, when the budget is phased. */
export function monthsFor(periodCode: string, percents: Map<number, number> | undefined) {
  if (!percents?.size) return undefined;
  const period = parsePeriod(periodCode, "2000-01-01");
  if (!period.calendar || period.year === null || period.part.type !== "year" || period.code !== periodCode) return undefined;
  return Array.from({ length: 12 }, (_, i) => {
    const m = monthOf(period.calendar!, period.year!, i + 1);
    return { start: m.start, end: m.end, percent: percents.get(i + 1) ?? 0 };
  });
}

/** Whether a budget's period is a whole year of one calendar, which is what can be phased by month. */
export function canPhase(periodCode: string): boolean {
  const period = parsePeriod(periodCode, "2000-01-01");
  return period.code === periodCode && period.calendar !== null && period.part.type === "year";
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

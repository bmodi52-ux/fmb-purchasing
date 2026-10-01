import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting } from "@/lib/app-settings";
import { comparisonPeriod, monthCalendarFor, parsePeriod, periodCode, yearContaining, type Period } from "@/lib/periods";
import {
  applyFilters,
  byCategory,
  byItem,
  byMonthBreakdown,
  percentChange,
  totals,
  NO_FILTERS,
  type Dimension,
  type MonthBreakdown,
} from "./aggregate.ts";
import { loadBudgetView } from "./budget-view.ts";
import { budgetUse, overdueOf, spendTrend, topOf, type BudgetUse, type Overdue, type Ranked, type TrendGrain, type TrendPoint } from "./dashboard.ts";
import { loadLedger } from "./ledger.ts";
import { spanOf, withinRange, type DateRange, type Ledger } from "./ledger-rows.ts";
import { loadAwaitingPayment } from "./money-out-data.ts";
import { waiting, type Waiting } from "./money-out.ts";
import { presetCode } from "./range-presets.ts";

/**
 * Loading the Reports dashboard (dashboard.ts). In two halves, so the page
 * can show each as it arrives: how things stand today, and a chosen period.
 * Both read what the reports themselves read.
 */

export type SpendFigure = {
  /** The period in words. */
  label: string;
  /** Its code, for the link to the Spending report on the same period. */
  code: string;
  spend: number;
  expenses: number;
  /** Against the same stretch of the period before; null when that had nothing in it. */
  change: number | null;
  against: string;
};

export type DashboardNow = {
  month: SpendFigure;
  /** FMB's own year so far — the Hijri year, which budgets run on. */
  year: SpendFigure;
  /** The Australian financial year so far, which the GST return runs on. */
  financialYear: { label: string; code: string; spend: number };
  overdue: Overdue;
  /** Everything approved and unpaid, by how long it has waited. */
  awaiting: Pick<Waiting, "count" | "amount" | "oldestDays" | "bands">;
  /** Null for someone who cannot see Budgets. */
  budget: (BudgetUse & { yearLabel: string; code: string }) | null;
};

function figure(ledger: Ledger, period: Period, today: string): SpendFigure {
  const sumOf = (range: DateRange) => {
    const part = withinRange(ledger, range);
    return totals(applyFilters(part.expenses, part.lines, NO_FILTERS));
  };
  const before = comparisonPeriod(period, today);
  const now = sumOf(period);
  const then = sumOf(before);
  return {
    label: period.label,
    code: period.code,
    spend: now.spend,
    expenses: now.expenseCount,
    change: then.expenseCount ? percentChange(now.spend, then.spend) : null,
    against: before.label,
  };
}

export async function loadDashboardNow(admin: SupabaseClient, today: string, canBudgets: boolean): Promise<DashboardNow> {
  const month = parsePeriod(presetCode("this-month", today), today);
  const year = parsePeriod("h-ytd", today);
  const financialYear = parsePeriod("au-ytd", today);
  // The year by its own name ("1447-48 H"), not "This Hijri year (…)": it is read mid-sentence.
  const budgetYear = parsePeriod(periodCode("hijri", yearContaining("hijri", today)), today);

  // One load of the ledger covers this month, both years so far, and the
  // stretches of last month and last year they are compared with.
  const span = spanOf(month, year, financialYear, comparisonPeriod(month, today), comparisonPeriod(year, today));

  const [ledger, approved, reminders, budgets] = await Promise.all([
    loadLedger(span),
    loadAwaitingPayment(admin),
    getSetting(admin, "reminders"),
    canBudgets ? loadBudgetView(admin, budgetYear) : Promise.resolve(null),
  ]);

  const queue = waiting(approved, (e) => e.decidedOn, today);
  const fy = withinRange(ledger, financialYear);

  return {
    month: figure(ledger, month, today),
    year: figure(ledger, year, today),
    financialYear: {
      label: financialYear.label,
      code: financialYear.code,
      spend: totals(applyFilters(fy.expenses, fy.lines, NO_FILTERS)).spend,
    },
    overdue: overdueOf(queue, reminders.payments.escalateAfterDays),
    awaiting: { count: queue.count, amount: queue.amount, oldestDays: queue.oldestDays, bands: queue.bands },
    budget: budgets ? { ...budgetUse(budgets.totals), yearLabel: budgetYear.label, code: budgetYear.code } : null,
  };
}

export type DashboardRange = {
  period: Period;
  spend: number;
  expenses: number;
  change: number | null;
  against: string;
  trend: { grain: TrendGrain; points: TrendPoint[] };
  topCategories: Ranked[];
  topItems: Ranked[];
  /** Spend month by month, split by category or by item. */
  overTime: MonthBreakdown;
  by: Extract<Dimension, "category" | "item">;
};

export async function loadDashboardRange(period: Period, by: "category" | "item", today: string): Promise<DashboardRange> {
  const before = comparisonPeriod(period, today);
  const ledger = await loadLedger(spanOf(period, before));
  const current = withinRange(ledger, period);
  const previous = withinRange(ledger, before);
  const slice = applyFilters(current.expenses, current.lines, NO_FILTERS);
  const now = totals(slice);
  const then = totals(applyFilters(previous.expenses, previous.lines, NO_FILTERS));
  const calendar = monthCalendarFor(period);

  return {
    period,
    spend: now.spend,
    expenses: now.expenseCount,
    change: then.expenseCount ? percentChange(now.spend, then.spend) : null,
    against: before.label,
    trend: spendTrend(slice, period, today, calendar),
    topCategories: topOf(byCategory(slice)),
    topItems: topOf(byItem(slice)),
    overTime: byMonthBreakdown(slice, by, 6, calendar),
    by,
  };
}

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAlertRules, type AlertEvent } from "@/lib/alert-rules";
import { parsePeriod, periodCode, yearContaining, type CalendarKind } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { budgetsForPeriod, loadBudgets } from "@/lib/budgets";

/**
 * Where the app's events meet the alert rules admins have built (#28).
 *
 * Each runs after the response, and only reads anything once a rule for that
 * event exists — so with no rules set up, an approval costs nothing extra.
 */

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

function later(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    void work();
  }
}

async function hasRules(admin: SupabaseClient, event: AlertEvent): Promise<boolean> {
  const { count, error } = await admin
    .from("alert_rules")
    .select("id", { count: "exact", head: true })
    .eq("event", event)
    .eq("active", true);
  return !error && (count ?? 0) > 0;
}

const WORDS: Record<"expense_submitted" | "expense_approved" | "expense_paid", string> = {
  expense_submitted: "submitted",
  expense_approved: "approved",
  expense_paid: "paid",
};

export function alertOnExpense(
  admin: SupabaseClient,
  event: "expense_submitted" | "expense_approved" | "expense_paid",
  expense: { id: string; expense_number?: string | null; vendor_name_raw: string | null; total: number }
): void {
  later(async () => {
    const [rules, budgetRules] = await Promise.all([
      hasRules(admin, event),
      event === "expense_submitted" ? hasRules(admin, "budget_threshold") : Promise.resolve(false),
    ]);
    if (!rules && !budgetRules) return;

    const [{ data: row }, { data: lines }] = await Promise.all([
      admin.from("expenses").select("vendor_id, receipt_date, created_at").eq("id", expense.id).maybeSingle(),
      admin.from("expense_line_items").select("category_id, line_total").eq("expense_id", expense.id),
    ]);
    const categoryIds = [...new Set((lines ?? []).map((l) => l.category_id as string | null).filter(Boolean) as string[])];

    if (rules) {
      await runAlertRules(
        admin,
        event,
        { amount: Number(expense.total), categoryIds, vendorId: (row?.vendor_id as string | null) ?? null },
        {
          title: `${expense.expense_number ?? "An expense"} ${WORDS[event]}`,
          body: `${expense.vendor_name_raw ?? "Vendor not recorded"} · ${money(Number(expense.total))}`,
          link: `/expenses/${expense.id}`,
          expenseId: expense.id,
        }
      );
    }

    if (budgetRules && row) {
      const date = (row.receipt_date as string | null) ?? (row.created_at as string).slice(0, 10);
      await checkBudgetThresholds(admin, date, categoryIds, lines ?? []);
    }
  });
}

/**
 * A budget alert fires when an expense takes a category across the rule's
 * percentage of its budget for the year the expense falls in — once per rule,
 * category, year and percentage.
 */
async function checkBudgetThresholds(
  admin: SupabaseClient,
  date: string,
  categoryIds: string[],
  lines: { category_id: unknown; line_total: unknown }[]
): Promise<void> {
  const { data: rules } = await admin
    .from("alert_rules")
    .select("conditions")
    .eq("event", "budget_threshold")
    .eq("active", true);
  const calendars = [
    ...new Set((rules ?? []).map((r) => ((r.conditions as { calendar?: CalendarKind })?.calendar ?? "hijri") as CalendarKind)),
  ];

  const { loadReportRawData, withinRange } = await import("@/app/(app)/reports/data");
  const budgets = await loadBudgets(admin, categoryIds);
  const today = todayIso();

  for (const calendar of calendars) {
    const period = parsePeriod(periodCode(calendar, yearContaining(calendar, date)), today);
    const perCategory = budgetsForPeriod(budgets, period.start, period.end);
    const raw = withinRange(await loadReportRawData(period), period);

    for (const categoryId of categoryIds) {
      const budget = perCategory.get(categoryId);
      if (!budget || budget.amount <= 0) continue;
      const spentAfter = raw.allLines.filter((l) => l.categoryId === categoryId).reduce((s, l) => s + l.lineTotal, 0);
      const thisExpense = lines
        .filter((l) => l.category_id === categoryId)
        .reduce((s, l) => s + Number(l.line_total), 0);
      const usedAfter = spentAfter / budget.amount;
      const usedBefore = (spentAfter - thisExpense) / budget.amount;

      const { data: category } = await admin.from("categories").select("name").eq("id", categoryId).maybeSingle();
      await runAlertRules(
        admin,
        "budget_threshold",
        { budget: { categoryId, usedBefore, usedAfter, calendar } },
        {
          title: `${category?.name ?? "A category"} has used ${Math.round(usedAfter * 100)}% of its budget`,
          body: `${money(spentAfter)} of ${money(budget.amount)} for ${period.label}.`,
          link: `/budgets?period=${period.code}`,
        },
        (rule) => `${categoryId}:${period.code}:${rule.conditions.budgetPercent}`
      );
    }
  }
}

export function alertOnVendorAdded(admin: SupabaseClient, vendor: { id: string; name: string }): void {
  later(async () => {
    if (!(await hasRules(admin, "vendor_added"))) return;
    await runAlertRules(
      admin,
      "vendor_added",
      { vendorId: vendor.id },
      { title: `New vendor: ${vendor.name}`, body: "Added to the Vendors list.", link: `/vendors/${vendor.id}` }
    );
  });
}

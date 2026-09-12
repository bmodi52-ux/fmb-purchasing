import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAlertRules, type AlertEvent } from "@/lib/alert-rules";
import { parsePeriod, periodCode, yearContaining, type CalendarKind } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { budgetsForPeriod, loadBudgets } from "@/lib/budgets";
import { getSetting } from "@/lib/app-settings";
import { notify, userIdsWithPermission } from "@/lib/notifications-inapp";

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
  if (event === "expense_submitted") alertOnPrices(admin, expense);

  later(async () => {
    const [rules, budgetRules, builtIn] = await Promise.all([
      hasRules(admin, event),
      event === "expense_submitted" ? hasRules(admin, "budget_threshold") : Promise.resolve(false),
      event === "expense_submitted" ? getSetting(admin, "budget_alerts") : Promise.resolve(null),
    ]);
    const builtInOn = !!builtIn?.enabled && builtIn.percents.length > 0;
    if (!rules && !budgetRules && !builtInOn) return;

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

    if ((budgetRules || builtInOn) && row) {
      const date = (row.receipt_date as string | null) ?? (row.created_at as string).slice(0, 10);
      await checkBudgetThresholds(admin, date, categoryIds, lines ?? [], budgetRules, builtInOn ? builtIn!.percents : []);
    }
  });
}

/**
 * A budget alert fires when an expense takes a category across a percentage
 * of its budget for the year the expense falls in: once per rule, category,
 * year and percentage for an admin's rules, and once per category, Hijri year
 * and percentage for the built-in alerts to whoever sets budgets (#39).
 */
async function checkBudgetThresholds(
  admin: SupabaseClient,
  date: string,
  categoryIds: string[],
  lines: { category_id: unknown; line_total: unknown }[],
  withRules: boolean,
  builtInPercents: number[]
): Promise<void> {
  const { data: rules } = withRules
    ? await admin.from("alert_rules").select("conditions").eq("event", "budget_threshold").eq("active", true)
    : { data: [] };
  const calendars = [
    ...new Set([
      ...(builtInPercents.length ? (["hijri"] as CalendarKind[]) : []),
      ...(rules ?? []).map((r) => ((r.conditions as { calendar?: CalendarKind })?.calendar ?? "hijri") as CalendarKind),
    ]),
  ];
  const budgetSetters = builtInPercents.length ? await userIdsWithPermission(admin, "budgets", "edit_master_data") : [];

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
      const message = {
        title: `${category?.name ?? "A category"} has used ${Math.round(usedAfter * 100)}% of its budget`,
        body: `${money(spentAfter)} of ${money(budget.amount)} for ${period.label}.`,
        link: `/budgets?period=${period.code}`,
      };

      if (withRules) {
        await runAlertRules(
          admin,
          "budget_threshold",
          { budget: { categoryId, usedBefore, usedAfter, calendar } },
          message,
          (rule) => `${categoryId}:${period.code}:${rule.conditions.budgetPercent}`
        );
      }

      if (calendar === "hijri") {
        for (const percent of builtInPercents) {
          const line = percent / 100;
          if (!(usedBefore < line && usedAfter >= line)) continue;
          const { error: already } = await admin
            .from("budget_alert_firings")
            .insert({ category_id: categoryId, period_code: period.code, percent });
          if (already) continue;
          await notify(
            admin,
            budgetSetters.map((userId) => ({ userId, kind: "alert" as const, title: message.title, body: message.body, link: message.link }))
          );
        }
      }
    }
  }
}

/**
 * Price moves and unusual spend on a submitted expense (#29, #42): whoever
 * edits the Pricelist is told, if that is switched on, and any alert rules
 * built on them run. Each flag is sent once, however often the expense is
 * edited and resubmitted.
 */
function alertOnPrices(
  admin: SupabaseClient,
  expense: { id: string; expense_number?: string | null; vendor_name_raw: string | null; total: number }
): void {
  later(async () => {
    const settings = await getSetting(admin, "price_alerts");
    if (!settings.enabled) return;
    const [priceRules, spendRules] = await Promise.all([hasRules(admin, "price_change"), hasRules(admin, "unusual_spend")]);
    if (!settings.notifyPricelistEditors && !priceRules && !spendRules) return;

    const { data: row } = await admin
      .from("expenses")
      .select("id, vendor_id, total, receipt_date, created_at")
      .eq("id", expense.id)
      .maybeSingle();
    if (!row) return;

    const { loadPriceFlags, loadSpendFlags } = await import("@/lib/price-alerts-data");
    const { describePriceFlag, describeUnusualSpend } = await import("@/lib/price-alerts");
    const [priceFlags, spendFlags] = await Promise.all([
      loadPriceFlags(admin, [expense.id], settings),
      loadSpendFlags(admin, [row as ExpenseForSpendRow], settings),
    ]);
    const flags = priceFlags.get(expense.id) ?? [];
    const spend = spendFlags.get(expense.id) ?? null;
    if (flags.length === 0 && !spend) return;

    const editors = settings.notifyPricelistEditors ? await userIdsWithPermission(admin, "pricelist", "edit_master_data") : [];
    const firstTime = async (key: string) => !(await admin.from("price_alert_firings").insert({ fired_key: key })).error;
    const ref = expense.expense_number ?? "An expense";
    const vendorId = (row.vendor_id as string | null) ?? null;

    if (flags.length) {
      const itemIds = [...new Set(flags.map((f) => f.itemId))];
      const { data: items } = await admin.from("items").select("id, category_id").in("id", itemIds);
      const categoryOf = new Map((items ?? []).map((i) => [i.id as string, i.category_id as string | null]));

      for (const flag of flags) {
        const key = `price:${flag.lineId}:${flag.kind}`;
        if (!(await firstTime(key))) continue;
        const message = {
          title: describePriceFlag(flag),
          body: `${ref} · ${expense.vendor_name_raw ?? "Vendor not recorded"}`,
          link: `/expenses/${expense.id}`,
          expenseId: expense.id,
        };
        await notify(admin, editors.map((userId) => ({ userId, kind: "alert" as const, ...message })));
        if (priceRules) {
          const categoryId = categoryOf.get(flag.itemId);
          await runAlertRules(
            admin,
            "price_change",
            { amount: Number(expense.total), categoryIds: categoryId ? [categoryId] : [], vendorId },
            message,
            () => key
          );
        }
      }
    }

    if (spend && (await firstTime(`spend:${expense.id}`))) {
      const message = {
        title: `${ref} is ${describeUnusualSpend(spend)}`,
        body: `${expense.vendor_name_raw ?? "Vendor not recorded"} · ${money(Number(expense.total))}`,
        link: `/expenses/${expense.id}`,
        expenseId: expense.id,
      };
      await notify(admin, editors.map((userId) => ({ userId, kind: "alert" as const, ...message })));
      if (spendRules) {
        const { data: lines } = await admin.from("expense_line_items").select("category_id").eq("expense_id", expense.id);
        const categoryIds = [...new Set((lines ?? []).map((l) => l.category_id as string | null).filter(Boolean) as string[])];
        await runAlertRules(
          admin,
          "unusual_spend",
          { amount: Number(expense.total), categoryIds, vendorId },
          message,
          () => `spend:${expense.id}`
        );
      }
    }
  });
}

type ExpenseForSpendRow = { id: string; vendor_id: string | null; total: number; receipt_date: string | null; created_at: string };

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

"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { parsePeriod } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { loadReportRawData, withinRange, type PaidCostRow } from "./data";
import { vendorKeyOf, categoryKeyOf, itemKeyOf, type ExpenseRecord, type LineRecord } from "./aggregate";

export type WidgetPreviewData = {
  expenses: ExpenseRecord[];
  lines: LineRecord[];
  paidCosts: PaidCostRow[];
  vendorOptions: { value: string; label: string }[];
  categoryOptions: { value: string; label: string }[];
  itemOptions: { value: string; label: string }[];
};

/** Dedupes {key, label} pairs into a sorted option list — same shape reports/page.tsx builds. */
function toSortedOptions(pairs: { key: string; label: string }[]): { value: string; label: string }[] {
  return [...new Map(pairs.map((p) => [p.key, p.label])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Raw rows for one period, plus the filter menus that go with it — what the
 * widget-builder dialog needs to let someone pick filters and see a live
 * preview before saving.
 */
export async function fetchWidgetPreviewData(periodCode: string): Promise<WidgetPreviewData> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");

  const period = parsePeriod(periodCode, todayIso());
  const { allExpenses: expenses, allLines: lines, paidCosts } = withinRange(await loadReportRawData(period), period);

  return {
    expenses,
    lines,
    paidCosts,
    vendorOptions: toSortedOptions(expenses.map(vendorKeyOf)),
    categoryOptions: toSortedOptions(lines.filter((l) => l.categoryId).map(categoryKeyOf)),
    itemOptions: toSortedOptions(lines.filter((l) => l.itemId).map(itemKeyOf)),
  };
}

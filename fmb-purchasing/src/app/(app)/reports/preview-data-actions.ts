"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { loadReportRawData, type PaidCostRow } from "./data";
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
 * Raw rows for one fiscal year, plus the filter menus that go with it — what
 * the widget-builder dialog needs to let someone pick filters and see a live
 * preview before saving. Scoped to a single year up front (rather than
 * shipping a fyOf map across the wire) since a widget only ever previews one
 * year at a time.
 */
export async function fetchWidgetPreviewData(fy: number): Promise<WidgetPreviewData> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");

  const { allExpenses, allLines, paidCosts, fyOf } = await loadReportRawData([fy]);
  const expenses = allExpenses.filter((e) => fyOf.get(e.id) === fy);
  const expenseIds = new Set(expenses.map((e) => e.id));
  const lines = allLines.filter((l) => expenseIds.has(l.expenseId));
  const scopedPaidCosts = paidCosts.filter((c) => expenseIds.has(c.expense_id));

  return {
    expenses,
    lines,
    paidCosts: scopedPaidCosts,
    vendorOptions: toSortedOptions(expenses.map(vendorKeyOf)),
    categoryOptions: toSortedOptions(lines.filter((l) => l.categoryId).map(categoryKeyOf)),
    itemOptions: toSortedOptions(lines.filter((l) => l.itemId).map(itemKeyOf)),
  };
}

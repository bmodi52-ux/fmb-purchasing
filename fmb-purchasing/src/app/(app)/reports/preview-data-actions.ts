"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { parsePeriod } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { filterOptionsFor, type FilterOption } from "@/lib/reporting/aggregate";
import { loadLedger } from "@/lib/reporting/ledger";
import type { Ledger } from "@/lib/reporting/ledger-rows";

export type WidgetPreviewData = Ledger & {
  vendorOptions: FilterOption[];
  categoryOptions: FilterOption[];
  itemOptions: FilterOption[];
};

/**
 * A period's ledger, plus the filter menus that go with it — what the
 * widget-builder dialog needs to let someone pick filters and see a live
 * preview before saving.
 */
export async function fetchWidgetPreviewData(periodCode: string): Promise<WidgetPreviewData> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");

  const ledger = await loadLedger(parsePeriod(periodCode, todayIso()));
  const options = filterOptionsFor(ledger.expenses, ledger.lines);

  return {
    ...ledger,
    vendorOptions: options.vendors,
    categoryOptions: options.categories,
    itemOptions: options.items,
  };
}

"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { parsePeriod } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { filterOptionsFor, type FilterOption } from "@/lib/reporting/aggregate";
import { loadLedger } from "@/lib/reporting/ledger";
import { computeWidgetData, widgetPeriodCode, type WidgetConfig, type WidgetData, type WidgetKind } from "./dashboard-widgets";

/**
 * What the widget-builder dialog needs from the server. It used to be sent a
 * period's whole ledger and work the preview out itself; now it asks for the
 * filter menus once per period, and for the preview each time the widget
 * changes — the figures, never the rows.
 */

async function requireReports() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");
}

export type WidgetOptions = {
  vendorOptions: FilterOption[];
  categoryOptions: FilterOption[];
  itemOptions: FilterOption[];
};

/** The filter menus for a period. */
export async function fetchWidgetOptions(periodCode: string): Promise<WidgetOptions> {
  await requireReports();
  const ledger = await loadLedger(parsePeriod(periodCode, todayIso()));
  const options = filterOptionsFor(ledger.expenses, ledger.lines);
  return { vendorOptions: options.vendors, categoryOptions: options.categories, itemOptions: options.items };
}

/** A widget as it would look saved — computed exactly as the home page will compute it. */
export async function previewWidget(kind: WidgetKind, config: WidgetConfig): Promise<WidgetData> {
  await requireReports();
  const today = todayIso();
  const ledger = await loadLedger(parsePeriod(widgetPeriodCode(config), today));
  return computeWidgetData(kind, config, ledger, today);
}

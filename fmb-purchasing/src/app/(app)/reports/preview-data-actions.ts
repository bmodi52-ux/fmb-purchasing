"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { parsePeriod } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { filterOptionsFor, type FilterOption } from "@/lib/reporting/aggregate";
import { loadLedger } from "@/lib/reporting/ledger";
import { canSeeReport } from "@/lib/reporting/registry";
import { computeWidgets, type WidgetData } from "@/lib/reporting/widget-data";
import { specFrom } from "@/lib/reporting/widgets";

/**
 * What the widget-builder dialog needs from the server: the filter menus once
 * per period, and the preview each time the widget changes — the figures,
 * never the rows.
 */

async function requireReports() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "reports", "view");
  return user;
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

/**
 * A widget as it would look saved — computed exactly as the home page will
 * compute it. Null for a spec that isn't one, or a report the person can't see.
 */
export async function previewWidget(raw: unknown): Promise<{ data: WidgetData | null; summary: string } | null> {
  const user = await requireReports();
  const spec = specFrom(raw);
  if (!spec || !(await canSeeReport(user, spec.report))) return null;
  const [computed] = await computeWidgets(createAdminClient(), [spec], todayIso());
  return computed;
}

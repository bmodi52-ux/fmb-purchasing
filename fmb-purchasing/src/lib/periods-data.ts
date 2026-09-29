import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInOrgZone } from "@/lib/fiscal-year";
import { isoFromLocal } from "@/lib/periods";

/**
 * The server half of periods (scratchpad #22): today in Sydney, and the
 * earliest record the year lists should start from.
 *
 * Which expenses belong to a range is a filter on expenses.report_date (0083),
 * the one day each expense counts on: `.gte("report_date", start)
 * .lte("report_date", end)`.
 */

/** Today's calendar day in Sydney, `YYYY-MM-DD`. */
export function todayIso(): string {
  return isoFromLocal(todayInOrgZone());
}

/**
 * The earliest day any expense belongs to, for the year lists — the same day
 * reports count it on (expenses.report_date).
 */
export async function earliestExpenseDate(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin.from("expenses").select("report_date").order("report_date").limit(1);
  return (data?.[0]?.report_date as string | undefined) ?? null;
}

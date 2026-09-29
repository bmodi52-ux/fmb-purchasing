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
 * reports count it on (expenses.report_date), leaving out receipt dates that
 * can't be right (expense_date_checks, 0084). One receipt misread as 1994 had
 * every period picker offering thirty years nobody bought anything in; it is
 * listed on Needs attention instead.
 */
export async function earliestExpenseDate(admin: SupabaseClient): Promise<string | null> {
  const { data } = await admin
    .from("expense_date_checks")
    .select("report_date")
    .is("concern", null)
    .order("report_date")
    .limit(1);
  return (data?.[0]?.report_date as string | undefined) ?? null;
}

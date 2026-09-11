import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInOrgZone } from "@/lib/fiscal-year";
import { isoFromLocal } from "@/lib/periods";

/**
 * The server half of periods (scratchpad #22): today in Sydney, the earliest
 * record the year lists should start from, and the filter that picks out the
 * expenses belonging to a range.
 */

/** Today's calendar day in Sydney, `YYYY-MM-DD`. */
export function todayIso(): string {
  return isoFromLocal(todayInOrgZone());
}

/**
 * The earliest day any expense belongs to, for the year lists. Receipt date
 * where there is one, submission otherwise — the same date reports count an
 * expense on (aggregate.ts expenseDate).
 */
export async function earliestExpenseDate(admin: SupabaseClient): Promise<string | null> {
  const [{ data: byReceipt }, { data: bySubmission }] = await Promise.all([
    admin.from("expenses").select("receipt_date").not("receipt_date", "is", null).order("receipt_date").limit(1),
    admin.from("expenses").select("created_at").order("created_at").limit(1),
  ]);
  const candidates = [
    byReceipt?.[0]?.receipt_date as string | undefined,
    (bySubmission?.[0]?.created_at as string | undefined)?.slice(0, 10),
  ].filter(Boolean) as string[];
  return candidates.length ? candidates.sort()[0] : null;
}

/**
 * A PostgREST `or` filter for expenses dated within a range.
 *
 * An expense is dated by its receipt, or by when it was submitted when the
 * receipt carried no date — matching expenseDate() in reports/aggregate.ts,
 * which reads the first ten characters of created_at, so the submission bound
 * is in UTC days to agree with it exactly.
 */
export function expenseDateFilter(start: string, end: string): string {
  const next = new Date(Date.UTC(+end.slice(0, 4), +end.slice(5, 7) - 1, +end.slice(8, 10) + 1))
    .toISOString()
    .slice(0, 10);
  return (
    `and(receipt_date.gte.${start},receipt_date.lte.${end}),` +
    `and(receipt_date.is.null,created_at.gte.${start}T00:00:00Z,created_at.lt.${next}T00:00:00Z)`
  );
}

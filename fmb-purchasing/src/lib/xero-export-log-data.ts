import type { SupabaseClient } from "@supabase/supabase-js";
import type { Period } from "@/lib/periods";
import { allRowsForIds } from "@/lib/supabase/all-rows";
import type { Bill, PriorBill } from "@/lib/xero-export-log";

/** Reading and writing the Xero export log (0087). Server only. */

/** Every earlier file's copy of these expenses. */
export async function loadPriorBills(admin: SupabaseClient, expenseIds: string[]): Promise<PriorBill[]> {
  const rows = await allRowsForIds<{
    export_id: string;
    expense_id: string;
    total: number | string;
    gst: number | string;
    xero_exports: { exported_at: string } | null;
  }>(expenseIds, (slice, from, to) =>
    admin
      .from("xero_export_expenses")
      .select("export_id, expense_id, total, gst, xero_exports!inner ( exported_at )")
      .in("expense_id", slice)
      .order("export_id")
      .order("expense_id")
      .range(from, to)
  );
  return rows.map((r) => ({
    expenseId: r.expense_id,
    exportedAt: r.xero_exports?.exported_at ?? "",
    total: Number(r.total),
    gst: Number(r.gst),
  }));
}

export type RecentExport = {
  exportedAt: string;
  by: string;
  periodLabel: string;
  basis: "receipt" | "paid";
  newOnly: boolean;
  bills: number;
  total: number;
};

/** The latest files downloaded for any period overlapping this one. */
export async function loadRecentExports(admin: SupabaseClient, range: { start: string; end: string }, limit = 5): Promise<RecentExport[]> {
  const { data } = await admin
    .from("xero_exports")
    .select("exported_at, period_label, basis, new_only, bill_count, total, profiles ( full_name )")
    .lte("start_date", range.end)
    .gte("end_date", range.start)
    .order("exported_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({
    exportedAt: r.exported_at as string,
    by: (r.profiles as unknown as { full_name: string } | null)?.full_name ?? "Someone no longer here",
    periodLabel: r.period_label as string,
    basis: r.basis as "receipt" | "paid",
    newOnly: r.new_only as boolean,
    bills: r.bill_count as number,
    total: Number(r.total),
  }));
}

/**
 * Records a downloaded file and the bills in it. Throws when it can't: a file
 * handed over unrecorded is exactly the one the next download can't warn about.
 */
export async function recordExport(
  admin: SupabaseClient,
  entry: {
    userId: string;
    period: Period;
    basis: "receipt" | "paid";
    newOnly: boolean;
    bills: Bill[];
    lineCount: number;
    missingAccountCodes: number;
  }
): Promise<void> {
  const cents = (n: number) => Math.round(n * 100) / 100;
  const { data, error } = await admin
    .from("xero_exports")
    .insert({
      exported_by: entry.userId,
      period_code: entry.period.code,
      period_label: entry.period.label,
      start_date: entry.period.start,
      end_date: entry.period.end,
      basis: entry.basis,
      new_only: entry.newOnly,
      bill_count: entry.bills.length,
      line_count: entry.lineCount,
      total: cents(entry.bills.reduce((s, b) => s + b.total, 0)),
      gst: cents(entry.bills.reduce((s, b) => s + b.gst, 0)),
      missing_account_codes: entry.missingAccountCodes,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "The download could not be recorded.");

  for (let i = 0; i < entry.bills.length; i += 500) {
    const { error: billsError } = await admin.from("xero_export_expenses").insert(
      entry.bills.slice(i, i + 500).map((b) => ({ export_id: data.id, expense_id: b.expenseId, total: b.total, gst: b.gst }))
    );
    if (billsError) {
      // Half a record would claim a file held fewer bills than it did.
      await admin.from("xero_exports").delete().eq("id", data.id);
      throw new Error(billsError.message);
    }
  }
}

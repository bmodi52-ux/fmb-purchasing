import type { SupabaseClient } from "@supabase/supabase-js";
import { allRowsForIds } from "@/lib/supabase/all-rows";
import type { GstExpense, GstLine } from "@/lib/gst-summary";
import type { XeroBillLine } from "@/lib/xero-export";
import { withStatusBasis, type DateBasis } from "@/lib/reporting/basis";
import { loadLedger, loadLedgerByPaymentDate } from "@/lib/reporting/ledger";
import { accountingFromLedger } from "@/lib/reporting/accounting";
import type { Lodgement } from "@/lib/gst-lodgement";

/**
 * The expenses and lines behind the Accounting page for a period (#38).
 *
 * Two ways to decide which expenses a period holds, because FMB's GST basis is
 * still to be confirmed:
 *
 *   receipt  approved or paid, dated in the period by receipt (accruals)
 *   paid     paid, with the payment dated in the period (cash)
 *
 * Both read the ledger every report reads (lib/reporting); this adds only what
 * the GST return needs besides.
 */

export type Basis = DateBasis;

export async function loadAccountingPeriod(
  admin: SupabaseClient,
  range: { start: string; end: string },
  basis: Basis
): Promise<{ gstExpenses: GstExpense[]; gstLines: GstLine[]; xeroLines: XeroBillLine[] }> {
  const ledger =
    basis === "paid" ? await loadLedgerByPaymentDate(range) : withStatusBasis(await loadLedger(range), "accrued");

  const ids = ledger.expenses.map((e) => e.id);
  const vendorIds = [...new Set(ledger.expenses.map((e) => e.vendorId).filter(Boolean) as string[])];
  const [attachments, vendors, { data: categories }, { data: locks }] = await Promise.all([
    allRowsForIds<{ expense_id: string; id: string }>(ids, (slice, from, to) =>
      admin.from("expense_attachments").select("id, expense_id").in("expense_id", slice).order("id").range(from, to)
    ),
    allRowsForIds<{ id: string; abn: string | null; gst_registered: boolean | null }>(vendorIds, (slice, from, to) =>
      admin.from("vendors").select("id, abn, gst_registered").in("id", slice).order("id").range(from, to)
    ),
    admin.from("categories").select("id, account_code"),
    admin.from("locked_periods").select("start_date, end_date, locked_at").is("unlocked_at", null),
  ]);

  return accountingFromLedger(ledger, {
    withReceipt: new Set(attachments.map((a) => a.expense_id)),
    vendors: new Map(vendors.map((v) => [v.id, v])),
    locks: (locks ?? []) as { start_date: string; end_date: string; locked_at: string }[],
    accountCodeByCategory: new Map(
      (categories ?? []).map((c) => [c.id as string, (c.account_code as string | null) ?? null])
    ),
  });
}

/**
 * Each earlier lodged period's expenses as they stand now, read on the basis
 * it was lodged on — what outstandingAdjustments compares with what was
 * lodged. Only lodgements that kept figures (0085), and only those ending
 * before `before`: a return takes adjustments from periods before it.
 */
export async function loadLodgedPeriods(
  admin: SupabaseClient,
  lodgements: Lodgement[],
  before: string
): Promise<{ lodgement: Lodgement; expenses: GstExpense[]; lines: GstLine[] }[]> {
  const earlier = lodgements.filter((l) => l.basis && l.end < before);
  return Promise.all(
    earlier.map(async (lodgement) => {
      const { gstExpenses, gstLines } = await loadAccountingPeriod(admin, lodgement, lodgement.basis!);
      return { lodgement, expenses: gstExpenses, lines: gstLines };
    })
  );
}

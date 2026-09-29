"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission, type ActionKey } from "@/lib/permissions";
import { parsePeriod } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { loadAccountingPeriod, loadLodgedPeriods, type Basis } from "@/lib/accounting-data";
import { LOCK_COLUMNS, lodgementFromRow, lodgementSnapshot, outstandingAdjustments } from "@/lib/gst-lodgement";
import { buildXeroBillsCsv, linesMissingAccountCodes } from "@/lib/xero-export";
import { billHistory, billsOf, linesToExport } from "@/lib/xero-export-log";
import { loadPriorBills, recordExport } from "@/lib/xero-export-log-data";
import { reportError } from "@/lib/errors";

async function requireAccounting(action: ActionKey = "manage") {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "accounting", action);
  return user;
}

/**
 * The Xero bills file for a period (#38), recorded as it is handed over
 * (0087). With `newOnly`, bills an earlier file already held are left out, so
 * importing this one doesn't add them to Xero a second time.
 */
export async function exportXeroBills(
  periodCode: string,
  basis: Basis,
  newOnly = false
): Promise<{
  filename: string;
  content: string;
  rows: number;
  bills: number;
  missingAccountCodes: number;
  /** Bills in the file that an earlier file held too. */
  sentBefore: number;
  /** Of those, how many have changed since — to correct in Xero by hand. */
  changedSince: number;
  /** Bills left out because an earlier file held them. */
  leftOut: number;
}> {
  const user = await requireAccounting("export");
  const period = parsePeriod(periodCode, todayIso());
  const admin = createAdminClient();
  const { xeroLines } = await loadAccountingPeriod(admin, period, basis);

  const all = billsOf(xeroLines);
  const history = billHistory(all, await loadPriorBills(admin, all.map((b) => b.expenseId)));
  const lines = linesToExport(xeroLines, history, newOnly);
  const bills = billsOf(lines);
  const included = new Set(bills.map((b) => b.expenseId));
  const sent = history.sent.filter((b) => included.has(b.expenseId));
  const missingAccountCodes = linesMissingAccountCodes(lines);

  if (bills.length > 0) {
    try {
      await recordExport(admin, { userId: user.id, period, basis, newOnly, bills, lineCount: lines.length, missingAccountCodes });
    } catch (e) {
      await reportError({ source: "xero-export", error: e instanceof Error ? e.message : String(e), userId: user.id });
      throw new Error("The file couldn't be recorded, so it wasn't made. Try again.");
    }
  }

  return {
    filename: `xero-bills-${period.code}-${basis}${newOnly ? "-new" : ""}.csv`,
    content: buildXeroBillsCsv(lines),
    rows: lines.length,
    bills: bills.length,
    missingAccountCodes,
    sentBefore: sent.length,
    changedSince: history.sent.filter((b) => b.changed).length,
    leftOut: newOnly ? history.sent.length : 0,
  };
}

export async function setCategoryAccountCode(formData: FormData): Promise<void> {
  const user = await requireAccounting();
  const categoryId = String(formData.get("category_id") ?? "");
  const code = String(formData.get("account_code") ?? "").trim().slice(0, 20) || null;
  if (!categoryId) return;
  const { error } = await createAdminClient().from("categories").update({ account_code: code }).eq("id", categoryId);
  if (error) {
    await reportError({ source: "account-codes", error: error.message, userId: user.id });
    throw new Error("The account code could not be saved. Try again.");
  }
  revalidatePath("/accounting");
}

/**
 * Locks a period once its GST return is lodged. Decisions and payments dated
 * inside it can no longer be undone, and its lines can't be reclassified.
 */
export async function lockPeriod(formData: FormData): Promise<void> {
  const user = await requireAccounting();
  const period = parsePeriod(String(formData.get("period") ?? ""), todayIso());
  const note = String(formData.get("note") ?? "").trim() || null;
  // The basis on screen when the period was locked is the one it was lodged on.
  const basis: Basis = formData.get("basis") === "paid" ? "paid" : "receipt";
  const admin = createAdminClient();

  // What goes on the return: this period's figures, and the adjustments owed
  // to it by earlier lodged periods — recorded, so a re-reading of this
  // period later can say what was lodged, and no later return takes the same
  // adjustment again (0085).
  const [{ gstExpenses, gstLines }, { data: lockRows }] = await Promise.all([
    loadAccountingPeriod(admin, period, basis),
    admin.from("locked_periods").select(LOCK_COLUMNS).is("unlocked_at", null),
  ]);
  const lodgements = (lockRows ?? []).map(lodgementFromRow);
  const owed = outstandingAdjustments(await loadLodgedPeriods(admin, lodgements, period.start), lodgements);

  const { error } = await admin.from("locked_periods").insert({
    start_date: period.start,
    end_date: period.end,
    label: period.label,
    note,
    locked_by: user.id,
    ...lodgementSnapshot(gstExpenses, gstLines, basis, owed.expenses),
  });
  if (error) {
    await reportError({ source: "locked-periods", error: error.message, userId: user.id });
    throw new Error("The period could not be locked. Try again.");
  }
  revalidatePath("/accounting");
}

export async function unlockPeriod(formData: FormData): Promise<void> {
  const user = await requireAccounting();
  const id = String(formData.get("lock_id") ?? "");
  if (!id) return;
  await createAdminClient()
    .from("locked_periods")
    .update({ unlocked_at: new Date().toISOString(), unlocked_by: user.id })
    .eq("id", id)
    .is("unlocked_at", null);
  revalidatePath("/accounting");
}

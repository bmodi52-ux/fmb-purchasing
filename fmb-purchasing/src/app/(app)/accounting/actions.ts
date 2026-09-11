"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { parsePeriod } from "@/lib/periods";
import { todayIso } from "@/lib/periods-data";
import { loadAccountingPeriod, type Basis } from "@/lib/accounting-data";
import { buildXeroBillsCsv, linesMissingAccountCodes } from "@/lib/xero-export";
import { reportError } from "@/lib/errors";

async function requireAccounting() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");
  return user;
}

/** The Xero bills file for a period (#38). */
export async function exportXeroBills(
  periodCode: string,
  basis: Basis
): Promise<{ filename: string; content: string; rows: number; missingAccountCodes: number }> {
  await requireAccounting();
  const period = parsePeriod(periodCode, todayIso());
  const { xeroLines } = await loadAccountingPeriod(createAdminClient(), period, basis);
  return {
    filename: `xero-bills-${period.code}-${basis}.csv`,
    content: buildXeroBillsCsv(xeroLines),
    rows: xeroLines.length,
    missingAccountCodes: linesMissingAccountCodes(xeroLines),
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
  const { error } = await createAdminClient().from("locked_periods").insert({
    start_date: period.start,
    end_date: period.end,
    label: period.label,
    note,
    locked_by: user.id,
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

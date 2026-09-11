"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can } from "@/lib/permissions";
import { reportError } from "@/lib/errors";

/**
 * Marks one goods line as a capital purchase, or not (0048, #50).
 *
 * The GST return reports capital purchases apart from everything else, and
 * that is a judgement for whoever approves or pays, not for the person who
 * photographed the receipt — so it is set here, on the record, at any status.
 */
export async function setLineCapital(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const permissions = await getUserPermissions(user);
  if (!can(permissions, "approvals", "approve") && !can(permissions, "payments", "mark_paid")) redirect("/");

  const lineId = String(formData.get("line_id"));
  const expenseId = String(formData.get("expense_id"));
  const capital = String(formData.get("capital")) === "true";
  if (!lineId || !expenseId) return;

  const admin = createAdminClient();
  // A lodged period's figures stay as they were reported (#38).
  const { data: locked, error: lockError } = await admin.rpc("expense_in_locked_period", { p_expense_id: expenseId });
  if (!lockError && locked) {
    throw new Error("This expense is dated in a period whose GST return has been lodged, so its lines can't be reclassified.");
  }

  const { error } = await admin
    .from("expense_line_items")
    .update({ is_capital: capital })
    .eq("id", lineId)
    .eq("expense_id", expenseId)
    .eq("kind", "goods");

  if (error) {
    await reportError({ source: "line-capital", error: error.message, userId: user.id, expenseId });
    throw new Error("The line could not be changed. Try again.");
  }
  revalidatePath(`/expenses/${expenseId}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { revalidateReports } from "../reports/data";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { reportError } from "@/lib/errors";

/**
 * Withdraws the expenses among these that the user may withdraw — their own,
 * still awaiting a decision — and skips the rest.
 *
 * This replaced deleting them (0043, 0044). Deletion removed the row, its
 * lines, its files and its history, so a receipt submitted, deleted and
 * submitted again left no trace of the first attempt. A withdrawn expense
 * keeps all of that, drops out of reports and the approval queue, and stays on
 * the submitter's own list marked Withdrawn.
 */
async function withdraw(userId: string, expenseIds: string[]): Promise<void> {
  if (expenseIds.length === 0) return;

  const { error } = await createAdminClient().rpc("withdraw_expenses", {
    p_expense_ids: expenseIds,
    p_actor: userId,
  });

  if (error) {
    await reportError({ source: "expense-withdraw", error: error.message, userId });
    throw new Error("The submission could not be withdrawn, and nothing was changed. Try again.");
  }
}

function revalidateAll() {
  revalidatePath("/my-submissions");
  revalidatePath("/approvals");
  revalidatePath("/expenses");
  revalidatePath("/expenses/[id]", "page");
  revalidateReports();
}

export async function withdrawExpense(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "edit_own");

  const expenseId = String(formData.get("expense_id"));
  if (!expenseId) return;

  await withdraw(user.id, [expenseId]);
  revalidateAll();
}

export async function bulkWithdrawExpenses(expenseIds: string[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "edit_own");
  if (expenseIds.length === 0) return;

  await withdraw(user.id, expenseIds);
  revalidateAll();
}

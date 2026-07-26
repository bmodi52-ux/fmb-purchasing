"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";

async function deleteExpenseById(userId: string, expenseId: string, admin: ReturnType<typeof createAdminClient>) {
  const { data: expense } = await admin
    .from("expenses")
    .select("id, submitted_by, status")
    .eq("id", expenseId)
    .maybeSingle();

  if (!expense || expense.submitted_by !== userId || expense.status !== "submitted") return;

  await admin.from("expense_status_history").delete().eq("expense_id", expenseId);
  await admin.from("expense_line_items").delete().eq("expense_id", expenseId);
  await admin.from("expenses").delete().eq("id", expenseId);
}

export async function deleteExpense(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const expenseId = String(formData.get("expense_id"));
  if (!expenseId) return;

  const admin = createAdminClient();
  await deleteExpenseById(user.id, expenseId, admin);
  revalidatePath("/my-submissions");
}

/** Deletes any selected expenses that are still eligible (own, still "submitted"); silently skips the rest. */
export async function bulkDeleteExpenses(expenseIds: string[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (expenseIds.length === 0) return;

  const admin = createAdminClient();
  for (const id of expenseIds) {
    await deleteExpenseById(user.id, id, admin);
  }
  revalidatePath("/my-submissions");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { notifyExpenseDecision } from "@/lib/expense-notifications";

async function reviewOneExpense(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  expenseId: string,
  decision: "approved" | "declined",
  comment: string | null
) {
  const { data: expense } = await admin
    .from("expenses")
    .select("id, expense_number, status, vendor_name_raw, total, submitted_by")
    .eq("id", expenseId)
    .maybeSingle();
  if (!expense || expense.status !== "submitted") return;

  await admin
    .from("expenses")
    .update({
      status: decision,
      decision_comment: comment,
      decided_by: userId,
      decided_at: new Date().toISOString(),
    })
    .eq("id", expenseId);

  await admin.from("expense_status_history").insert({
    expense_id: expenseId,
    from_status: "submitted",
    to_status: decision,
    actor_id: userId,
    comment,
  });

  await notifyExpenseDecision(expense, decision, comment);
}

export async function reviewExpense(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "approvals", "approve");

  const expenseId = String(formData.get("expense_id"));
  const decision = String(formData.get("decision"));
  const comment = String(formData.get("comment") ?? "").trim() || null;
  if (!expenseId || (decision !== "approved" && decision !== "declined")) return;

  const admin = createAdminClient();
  await reviewOneExpense(admin, user.id, expenseId, decision, comment);

  revalidatePath("/approvals");
  revalidatePath("/my-submissions");
  revalidatePath("/expenses");
  revalidatePath("/payments");
}

export async function bulkReviewExpenses(expenseIds: string[], decision: "approved" | "declined") {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "approvals", "approve");
  if (expenseIds.length === 0) return;

  const admin = createAdminClient();
  for (const id of expenseIds) {
    await reviewOneExpense(admin, user.id, id, decision, null);
  }

  revalidatePath("/approvals");
  revalidatePath("/my-submissions");
  revalidatePath("/expenses");
  revalidatePath("/payments");
}

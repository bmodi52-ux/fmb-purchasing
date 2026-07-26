"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { notifyExpensePaid } from "@/lib/expense-notifications";

async function markOnePaid(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  expenseId: string,
  paymentDate: string,
  paymentReference: string | null
) {
  const { data: expense } = await admin
    .from("expenses")
    .select("id, status, vendor_name_raw, total, submitted_by")
    .eq("id", expenseId)
    .maybeSingle();
  if (!expense || expense.status !== "approved") return;

  await admin
    .from("expenses")
    .update({
      status: "paid",
      payment_reference: paymentReference,
      payment_date: paymentDate,
      paid_by: userId,
    })
    .eq("id", expenseId);

  await admin.from("expense_status_history").insert({
    expense_id: expenseId,
    from_status: "approved",
    to_status: "paid",
    actor_id: userId,
    comment: paymentReference ? `Payment reference: ${paymentReference}` : null,
  });

  await notifyExpensePaid(expense, paymentReference);
}

export async function markExpensePaid(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const expenseId = String(formData.get("expense_id"));
  const paymentReference = String(formData.get("payment_reference") ?? "").trim() || null;
  const paymentDate = String(formData.get("payment_date") ?? "").trim() || null;
  if (!expenseId || !paymentDate) return;

  const admin = createAdminClient();
  await markOnePaid(admin, user.id, expenseId, paymentDate, paymentReference);

  revalidatePath("/payments");
  revalidatePath("/my-submissions");
  revalidatePath("/expenses");
}

/** Marks all selected expenses paid on the same date, with an optional shared reference. */
export async function bulkMarkPaid(expenseIds: string[], paymentDate: string, paymentReference: string | null) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");
  if (expenseIds.length === 0 || !paymentDate) return;

  const admin = createAdminClient();
  for (const id of expenseIds) {
    await markOnePaid(admin, user.id, id, paymentDate, paymentReference);
  }

  revalidatePath("/payments");
  revalidatePath("/my-submissions");
  revalidatePath("/expenses");
}

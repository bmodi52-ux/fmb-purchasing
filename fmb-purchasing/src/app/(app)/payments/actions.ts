"use server";

import { revalidatePath } from "next/cache";
import { revalidateReports } from "../reports/data";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { notifyExpensePaid } from "@/lib/expense-notifications";
import { reportError } from "@/lib/errors";

type PaidExpense = {
  run_id: string | null;
  id: string;
  expense_number: string | null;
  vendor_name_raw: string | null;
  total: number;
  submitted_by: string;
  payee_id: string | null;
};

function revalidateAll() {
  revalidatePath("/payments");
  revalidatePath("/my-submissions");
  revalidatePath("/expenses");
  revalidatePath("/expenses/[id]", "page");
  revalidateReports();
}

/**
 * Records one bank transfer against every expense it settles.
 *
 * One email arriving today headed "Please pay Burhanuddin Modi directly
 * $1,819.21" carries six receipts and one transfer; after cutover that is six
 * expenses the Treasurer settles together. When they share a payee, a
 * payment_runs row (0029) records the transfer itself, and each expense keeps
 * its own date and reference stamped from it.
 *
 * One database function (0042): the run, the six status changes and the six
 * history rows are written together or not at all. As separate writes, a
 * failure part-way left an empty run in the ledger, or expenses marked paid
 * with no record of who paid them — and the page said it had worked.
 */
async function pay(
  userId: string,
  expenseIds: string[],
  paymentDate: string,
  paymentReference: string | null,
  note: string | null
): Promise<{ runId: string | null; paidCount: number }> {
  if (expenseIds.length === 0 || !paymentDate) return { runId: null, paidCount: 0 };

  const { data, error } = await createAdminClient().rpc("pay_expenses", {
    p_expense_ids: expenseIds,
    p_actor: userId,
    p_payment_date: paymentDate,
    p_payment_reference: paymentReference,
    p_note: note,
  });

  if (error) {
    await reportError({
      source: "expense-payment",
      error: error.message,
      detail: `${expenseIds.length} expense(s) on ${paymentDate}: ${expenseIds.join(", ")}`,
      userId,
    });
    throw new Error("The payment could not be recorded, and nothing was changed. Try again.");
  }

  const paid = (data ?? []) as PaidExpense[];
  await Promise.all(paid.map((e) => notifyExpensePaid(e, paymentReference)));
  return { runId: paid[0]?.run_id ?? null, paidCount: paid.length };
}

export async function markExpensePaid(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const expenseId = String(formData.get("expense_id"));
  const paymentReference = String(formData.get("payment_reference") ?? "").trim() || null;
  const paymentDate = String(formData.get("payment_date") ?? "").trim() || null;
  if (!expenseId || !paymentDate) return;

  await pay(user.id, [expenseId], paymentDate, paymentReference, null);
  revalidateAll();
}

/** Marks all selected expenses paid on the same date, with an optional shared reference. */
export async function bulkMarkPaid(
  expenseIds: string[],
  paymentDate: string,
  paymentReference: string | null,
  note?: string | null
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");
  if (expenseIds.length === 0 || !paymentDate) return;

  await pay(user.id, expenseIds, paymentDate, paymentReference, note ?? null);
  revalidateAll();
}

/**
 * Unwinds a payment recorded in error — see migrations 0029 and 0042.
 *
 * Returns the expense to approved, where it can be paid again properly, and
 * says so on the record. The reason is mandatory: this is the transition
 * someone will need explained when they audit the year.
 */
export async function reversePayment(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const expenseId = String(formData.get("expense_id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!expenseId || !reason) return;

  const { error } = await createAdminClient().rpc("reverse_payment", {
    p_expense_id: expenseId,
    p_actor: user.id,
    p_reason: reason,
  });

  if (error) {
    await reportError({ source: "payment-reversal", error: error.message, userId: user.id, expenseId });
    throw new Error("The payment could not be reversed, and nothing was changed. Try again.");
  }

  revalidateAll();
}

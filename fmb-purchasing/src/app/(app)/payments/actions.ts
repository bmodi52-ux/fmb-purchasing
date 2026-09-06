"use server";

import { revalidatePath } from "next/cache";
import { revalidateReports } from "../reports/data";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { notifyExpensePaid } from "@/lib/expense-notifications";

type PayableExpense = {
  id: string;
  expense_number: string | null;
  status: string;
  vendor_name_raw: string | null;
  total: number;
  submitted_by: string;
  payee_id: string | null;
};

function revalidateAll() {
  revalidatePath("/payments");
  revalidatePath("/my-submissions");
  revalidatePath("/expenses");
  revalidateReports();
}

/**
 * Records one bank transfer against every expense it settles.
 *
 * Set-based rather than a loop, for the reason in approvals/actions.ts: this
 * was four sequential statements per expense, and a real payment now covers
 * several of them. One email arriving today headed "Please pay Burhanuddin
 * Modi directly $1,819.21" carries six receipts and one transfer; after
 * cutover that is six expenses the Treasurer settles together.
 *
 * When they all share a payee, a payment_runs row (0029) records the transfer
 * itself, and each expense keeps its own date and reference stamped from it —
 * so an expense can still answer "when were you paid" without a join, while
 * the run answers "what did that $1,819.21 cover".
 */
async function pay(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  expenseIds: string[],
  paymentDate: string,
  paymentReference: string | null,
  note: string | null
): Promise<{ runId: string | null; paidCount: number }> {
  if (expenseIds.length === 0 || !paymentDate) return { runId: null, paidCount: 0 };

  const { data: expenses } = await admin
    .from("expenses")
    .select("id, expense_number, status, vendor_name_raw, total, submitted_by, payee_id")
    .in("id", expenseIds)
    .eq("status", "approved");

  const payable = (expenses ?? []) as PayableExpense[];
  if (payable.length === 0) return { runId: null, paidCount: 0 };

  const ids = payable.map((e) => e.id);

  // A run needs one payee. A mixed selection is still paid — the Treasurer
  // may genuinely be clearing several people at once — it simply is not one
  // transfer, so it gets no run.
  const payees = [...new Set(payable.map((e) => e.payee_id).filter(Boolean))];
  let runId: string | null = null;
  if (payees.length === 1 && payees[0]) {
    const { data: run } = await admin
      .from("payment_runs")
      .insert({
        payee_id: payees[0],
        payment_date: paymentDate,
        payment_reference: paymentReference,
        note,
        paid_by: userId,
      })
      .select("id")
      .single();
    runId = (run?.id as string) ?? null;
  }

  // status = 'approved' restated so this is a compare-and-set: an expense
  // already paid by someone else is left alone rather than double-stamped.
  await admin
    .from("expenses")
    .update({
      status: "paid",
      payment_reference: paymentReference,
      payment_date: paymentDate,
      paid_by: userId,
      payment_run_id: runId,
    })
    .in("id", ids)
    .eq("status", "approved");

  await admin.from("expense_status_history").insert(
    ids.map((id) => ({
      expense_id: id,
      from_status: "approved",
      to_status: "paid",
      actor_id: userId,
      comment: paymentReference ? `Payment reference: ${paymentReference}` : null,
    }))
  );

  await Promise.all(payable.map((e) => notifyExpensePaid(e, paymentReference)));
  return { runId, paidCount: payable.length };
}

export async function markExpensePaid(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const expenseId = String(formData.get("expense_id"));
  const paymentReference = String(formData.get("payment_reference") ?? "").trim() || null;
  const paymentDate = String(formData.get("payment_date") ?? "").trim() || null;
  if (!expenseId || !paymentDate) return;

  await pay(createAdminClient(), user.id, [expenseId], paymentDate, paymentReference, null);
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

  await pay(createAdminClient(), user.id, expenseIds, paymentDate, paymentReference, note ?? null);
  revalidateAll();
}

/**
 * Unwinds a payment recorded in error — see migration 0029.
 *
 * "Paid" was terminal, so a mistyped reference or a transfer that never left
 * the bank could only be corrected in the database itself. This returns the
 * expense to approved, where it can be paid again properly, and says so on the
 * record.
 *
 * The reason is mandatory: this is the transition someone will need explained
 * when they audit the year.
 */
export async function reversePayment(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const expenseId = String(formData.get("expense_id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!expenseId || !reason) return;

  const admin = createAdminClient();
  const { data: expense } = await admin
    .from("expenses")
    .select("id, status, payment_run_id")
    .eq("id", expenseId)
    .maybeSingle();
  if (!expense || expense.status !== "paid") return;

  await admin
    .from("expenses")
    .update({
      status: "approved",
      payment_reference: null,
      payment_date: null,
      paid_by: null,
      payment_run_id: null,
    })
    .eq("id", expenseId)
    .eq("status", "paid");

  await admin.from("expense_status_history").insert({
    expense_id: expenseId,
    from_status: "paid",
    to_status: "approved",
    actor_id: user.id,
    comment: reason,
    is_reversal: true,
  });

  // A run that no longer settles anything is noise in the ledger. One that
  // still covers other expenses stays, with its total now smaller — which is
  // the truth of what happened.
  if (expense.payment_run_id) {
    const { count } = await admin
      .from("expenses")
      .select("id", { count: "exact", head: true })
      .eq("payment_run_id", expense.payment_run_id);
    if ((count ?? 0) === 0) {
      await admin.from("payment_runs").delete().eq("id", expense.payment_run_id);
    }
  }

  revalidateAll();
}

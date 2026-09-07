"use server";

import { revalidatePath } from "next/cache";
import { revalidateReports } from "../reports/data";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { notifyExpenseDecision } from "@/lib/expense-notifications";

type DecidableExpense = {
  id: string;
  expense_number: string | null;
  status: string;
  vendor_name_raw: string | null;
  total: number;
  submitted_by: string;
};

/**
 * Approves or declines every expense in the list that is still awaiting a
 * decision, and ignores the rest.
 *
 * Set-based, not a loop. This used to run four sequential statements per
 * expense — read, update, history, notify — so approving forty of them was
 * about 160 round trips to a database on the other side of the country, one
 * after another. That was tolerable while approvals arrived one at a time.
 * It stops being tolerable now that a single email carrying six receipts
 * becomes six separate submissions, which makes bulk approval the normal way
 * to use this page rather than a convenience.
 *
 * Four queries now, whatever the size of the selection.
 */
async function decide(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  expenseIds: string[],
  decision: "approved" | "declined",
  comment: string | null
): Promise<void> {
  if (expenseIds.length === 0) return;

  const { data: expenses } = await admin
    .from("expenses")
    .select("id, expense_number, status, vendor_name_raw, total, submitted_by")
    .in("id", expenseIds)
    .eq("status", "submitted");

  const decidable = (expenses ?? []) as DecidableExpense[];
  if (decidable.length === 0) return;

  const ids = decidable.map((e) => e.id);
  const decidedAt = new Date().toISOString();

  // Re-stating status = 'submitted' makes this a compare-and-set: an expense
  // decided by someone else between the read above and this write is left
  // alone rather than having its decision overwritten.
  await admin
    .from("expenses")
    .update({
      status: decision,
      decision_comment: comment,
      decided_by: userId,
      decided_at: decidedAt,
    })
    .in("id", ids)
    .eq("status", "submitted");

  await admin.from("expense_status_history").insert(
    ids.map((id) => ({
      expense_id: id,
      from_status: "submitted",
      to_status: decision,
      actor_id: userId,
      comment,
    }))
  );

  // Notifications are a courtesy and are written in one batch inside notify();
  // a failure there must not undo a decision that has already been recorded.
  await Promise.all(decidable.map((e) => notifyExpenseDecision(e, decision, comment)));
}

function revalidateAll() {
  revalidatePath("/approvals");
  revalidatePath("/my-submissions");
  revalidatePath("/expenses");
  // The decision can now be made from the expense itself, so that page has to
  // stop showing the status it was made against.
  revalidatePath("/expenses/[id]", "page");
  revalidatePath("/payments");
  revalidateReports();
}

export async function reviewExpense(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "approvals", "approve");

  const expenseId = String(formData.get("expense_id"));
  const decision = String(formData.get("decision"));
  const comment = String(formData.get("comment") ?? "").trim() || null;
  if (!expenseId || (decision !== "approved" && decision !== "declined")) return;

  await decide(createAdminClient(), user.id, [expenseId], decision, comment);
  revalidateAll();
}

export async function bulkReviewExpenses(expenseIds: string[], decision: "approved" | "declined") {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "approvals", "approve");
  if (expenseIds.length === 0) return;

  await decide(createAdminClient(), user.id, expenseIds, decision, null);
  revalidateAll();
}

/**
 * Reopens a decision — see migration 0029.
 *
 * Approve and decline were terminal, which meant a mistake could only be
 * undone by editing the row in the Supabase dashboard: off the record,
 * invisible to the audit trail, and available only to whoever holds the
 * database password.
 *
 * The reason is mandatory. An approval can be silent because the expense
 * speaks for itself; an unwind cannot, because six months later the only
 * question anyone asks about it is what happened.
 */
export async function reopenExpense(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "approvals", "approve");

  const expenseId = String(formData.get("expense_id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!expenseId || !reason) return;

  const admin = createAdminClient();
  const { data: expense } = await admin
    .from("expenses")
    .select("id, status")
    .eq("id", expenseId)
    .maybeSingle();

  // Paid expenses are not reopened here. Money has already left the account,
  // so the correction belongs to whoever made the payment — see
  // payments/actions.ts.
  if (!expense || (expense.status !== "approved" && expense.status !== "declined")) return;

  await admin
    .from("expenses")
    .update({
      status: "submitted",
      decision_comment: null,
      decided_by: null,
      decided_at: null,
    })
    .eq("id", expenseId)
    .eq("status", expense.status);

  await admin.from("expense_status_history").insert({
    expense_id: expenseId,
    from_status: expense.status,
    to_status: "submitted",
    actor_id: user.id,
    comment: reason,
    is_reversal: true,
  });

  revalidateAll();
}

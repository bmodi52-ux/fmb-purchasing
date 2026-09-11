"use server";

import { revalidatePath } from "next/cache";
import { revalidateReports } from "../reports/data";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { notifyExpenseDecision } from "@/lib/expense-notifications";
import { reportError } from "@/lib/errors";

type DecidedExpense = {
  id: string;
  expense_number: string | null;
  vendor_name_raw: string | null;
  total: number;
  submitted_by: string;
};

/**
 * Approves or declines every expense in the list that is still awaiting a
 * decision, and ignores the rest.
 *
 * One database function (migration 0042), so the status change and its
 * history row are written together or not at all. This used to be two
 * separate writes whose errors nobody checked: a failure between them left a
 * decision with no record of who made it, and the page refreshed as though it
 * had worked.
 *
 * An expense decided by someone else a moment earlier is not among the rows
 * returned, and so is not notified about twice.
 */
async function decide(
  userId: string,
  expenseIds: string[],
  decision: "approved" | "declined",
  comment: string | null
): Promise<void> {
  if (expenseIds.length === 0) return;

  const { data, error } = await createAdminClient().rpc("decide_expenses", {
    p_expense_ids: expenseIds,
    p_actor: userId,
    p_decision: decision,
    p_comment: comment,
  });

  if (error) {
    await reportError({
      source: "expense-decision",
      error: error.message,
      detail: `${decision} ${expenseIds.length} expense(s): ${expenseIds.join(", ")}`,
      userId,
    });
    throw new Error("The decision could not be recorded, and nothing was changed. Try again.");
  }

  // Notifications are a courtesy; a failure there must not look like the
  // decision failed, because it did not.
  await Promise.all(
    ((data ?? []) as DecidedExpense[]).map((e) => notifyExpenseDecision(e, decision, comment))
  );
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

  await decide(user.id, [expenseId], decision, comment);
  revalidateAll();
}

export async function bulkReviewExpenses(expenseIds: string[], decision: "approved" | "declined") {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "approvals", "approve");
  if (expenseIds.length === 0) return;

  await decide(user.id, expenseIds, decision, null);
  revalidateAll();
}

/**
 * Reopens a decision — see migrations 0029 and 0042.
 *
 * The reason is mandatory, and enforced by the database function as well as
 * here. An approval can be silent because the expense speaks for itself; an
 * unwind cannot, because six months later the only question anyone asks about
 * it is what happened.
 *
 * Paid expenses are not reopened here: money has already left the account, so
 * the correction belongs to whoever made the payment — see payments/actions.ts.
 */
export async function reopenExpense(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "approvals", "approve");

  const expenseId = String(formData.get("expense_id"));
  const reason = String(formData.get("reason") ?? "").trim();
  if (!expenseId || !reason) return;

  const { error } = await createAdminClient().rpc("reopen_expense", {
    p_expense_id: expenseId,
    p_actor: user.id,
    p_reason: reason,
  });

  if (error) {
    await reportError({ source: "expense-reopen", error: error.message, userId: user.id, expenseId });
    throw new Error("The decision could not be reopened, and nothing was changed. Try again.");
  }

  revalidateAll();
}

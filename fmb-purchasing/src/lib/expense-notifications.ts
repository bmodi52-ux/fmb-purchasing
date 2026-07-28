import { createAdminClient } from "@/lib/supabase/admin";
import { notify, userIdsWithPermission } from "@/lib/notifications-inapp";

/**
 * Expense notifications, delivered in the app rather than by email.
 *
 * Every submission, decision and payment used to send mail. For anyone
 * handling several a day that buried the messages worth reading, so the same
 * events are now recorded as in-app notifications. Email is still used for
 * the one case the app can't cover — telling a brand new user how to log in,
 * see admin/users/actions.ts.
 */

type ExpenseSummary = {
  id: string;
  /** Human reference (E-0001) so a notification can be quoted aloud. */
  expense_number?: string | null;
  vendor_name_raw: string | null;
  total: number;
  submitted_by: string;
};

function money(n: number) {
  return `$${n.toFixed(2)} AUD`;
}

/** "E-0001 — Madani Mart", or just the vendor if numbering predates the row. */
function expenseRef(e: ExpenseSummary): string {
  const vendor = e.vendor_name_raw ?? "expense";
  return e.expense_number ? `${e.expense_number} — ${vendor}` : vendor;
}

export async function notifyExpenseSubmitted(expense: ExpenseSummary) {
  const admin = createAdminClient();
  const reviewers = await userIdsWithPermission(admin, "approvals", "approve");

  await notify(admin, [
    {
      userId: expense.submitted_by,
      kind: "expense_submitted",
      title: `Submitted ${expenseRef(expense)}`,
      body: `${money(expense.total)} — now waiting for review.`,
      link: "/my-submissions",
      expenseId: expense.id,
    },
    // the submitter may also be a reviewer; don't tell them twice
    ...reviewers
      .filter((id) => id !== expense.submitted_by)
      .map((userId) => ({
        userId,
        kind: "expense_to_review" as const,
        title: `New expense to review — ${expenseRef(expense)}`,
        body: `${money(expense.total)} is waiting for your decision.`,
        link: "/approvals",
        expenseId: expense.id,
      })),
  ]);
}

export async function notifyExpenseDecision(
  expense: ExpenseSummary,
  decision: "approved" | "declined",
  comment: string | null
) {
  const admin = createAdminClient();

  await notify(admin, [
    {
      userId: expense.submitted_by,
      kind: decision === "approved" ? "expense_approved" : "expense_declined",
      title:
        decision === "approved"
          ? `Approved — ${expenseRef(expense)}`
          : `Declined — ${expenseRef(expense)}`,
      body:
        decision === "approved"
          ? `${money(expense.total)} approved and passed to Accounts for reimbursement.${comment ? ` Comment: ${comment}` : ""}`
          : `${money(expense.total)} was declined. Please contact FMB Procurement Head.${comment ? ` Comment: ${comment}` : ""}`,
      link: "/my-submissions",
      expenseId: expense.id,
    },
  ]);
}

export async function notifyExpensePaid(expense: ExpenseSummary, paymentReference: string | null) {
  const admin = createAdminClient();

  await notify(admin, [
    {
      userId: expense.submitted_by,
      kind: "expense_paid",
      title: `Reimbursed — ${expenseRef(expense)}`,
      body: `${money(expense.total)} has been paid.${paymentReference ? ` Reference: ${paymentReference}` : ""}`,
      link: "/my-submissions",
      expenseId: expense.id,
    },
  ]);
}

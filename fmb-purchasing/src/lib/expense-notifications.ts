import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/notifications";
import type { PageKey, ActionKey } from "@/lib/permissions";

/** Contact emails for every active user whose team grants the given permission. */
async function emailsWithPermission(page: PageKey, action: ActionKey): Promise<string[]> {
  const admin = createAdminClient();
  const { data: teams } = await admin
    .from("team_permissions")
    .select("team_id")
    .eq("page_key", page)
    .eq("action_key", action);
  const teamIds = [...new Set((teams ?? []).map((t) => t.team_id))];
  if (teamIds.length === 0) return [];

  const { data: members } = await admin.from("team_members").select("user_id").in("team_id", teamIds);
  const userIds = [...new Set((members ?? []).map((m) => m.user_id))];
  if (userIds.length === 0) return [];

  const { data: profiles } = await admin
    .from("profiles")
    .select("email, is_active")
    .in("id", userIds)
    .eq("is_active", true);
  return (profiles ?? []).map((p) => p.email);
}

type ExpenseSummary = {
  id: string;
  vendor_name_raw: string | null;
  total: number;
  submitted_by: string;
};

async function submitterEmail(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<string | null> {
  const { data } = await admin.from("profiles").select("email").eq("id", userId).maybeSingle();
  return data?.email ?? null;
}

function money(n: number) {
  return `$${n.toFixed(2)} AUD`;
}

export async function notifyExpenseSubmitted(expense: ExpenseSummary) {
  const admin = createAdminClient();
  const [submitter, reviewers] = await Promise.all([
    submitterEmail(admin, expense.submitted_by),
    emailsWithPermission("approvals", "approve"),
  ]);

  if (submitter) {
    await sendEmail({
      to: submitter,
      subject: `Expense submitted — ${expense.vendor_name_raw ?? "expense"} (${money(expense.total)})`,
      html: `<p>Your expense for <strong>${expense.vendor_name_raw ?? "—"}</strong> (${money(expense.total)}) has been submitted for review.</p>`,
    });
  }
  if (reviewers.length) {
    await sendEmail({
      to: reviewers,
      subject: `New expense to review — ${expense.vendor_name_raw ?? "expense"} (${money(expense.total)})`,
      html: `<p>A new expense from <strong>${expense.vendor_name_raw ?? "—"}</strong> (${money(expense.total)}) is waiting for review.</p>`,
    });
  }
}

export async function notifyExpenseDecision(
  expense: ExpenseSummary,
  decision: "approved" | "declined",
  comment: string | null
) {
  const admin = createAdminClient();
  const submitter = await submitterEmail(admin, expense.submitted_by);
  if (!submitter) return;

  const html =
    decision === "approved"
      ? `<p>Your expense for <strong>${expense.vendor_name_raw ?? "—"}</strong> (${money(expense.total)}) was approved and has moved to Accounts for reimbursement.</p>${comment ? `<p>Comment: ${comment}</p>` : ""}`
      : `<p>Declined — please contact FMB Procurement Head.</p>${comment ? `<p>Comment: ${comment}</p>` : ""}<p>Expense: ${expense.vendor_name_raw ?? "—"} (${money(expense.total)})</p>`;

  await sendEmail({
    to: submitter,
    subject: `Expense ${decision} — ${expense.vendor_name_raw ?? "expense"}`,
    html,
  });
}

export async function notifyExpensePaid(expense: ExpenseSummary, paymentReference: string | null) {
  const admin = createAdminClient();
  const submitter = await submitterEmail(admin, expense.submitted_by);
  if (!submitter) return;

  await sendEmail({
    to: submitter,
    subject: `Expense reimbursed — ${expense.vendor_name_raw ?? "expense"} (${money(expense.total)})`,
    html: `<p>Your expense for <strong>${expense.vendor_name_raw ?? "—"}</strong> (${money(expense.total)}) has been paid.${paymentReference ? ` Reference: ${paymentReference}.` : ""}</p>`,
  });
}

import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail, emailTemplate, detailsBox } from "@/lib/notifications";
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

  const details = detailsBox([
    { label: "Vendor", value: expense.vendor_name_raw ?? "—" },
    { label: "Total", value: money(expense.total) },
  ]);

  if (submitter) {
    await sendEmail({
      to: submitter,
      subject: `Expense submitted — ${expense.vendor_name_raw ?? "expense"} (${money(expense.total)})`,
      html: emailTemplate(
        `<p style="margin:0 0 8px 0;">Your expense has been submitted for review.</p>${details}`
      ),
    });
  }
  if (reviewers.length) {
    await sendEmail({
      to: reviewers,
      subject: `New expense to review — ${expense.vendor_name_raw ?? "expense"} (${money(expense.total)})`,
      html: emailTemplate(
        `<p style="margin:0 0 8px 0;">A new expense is waiting for your review.</p>${details}`
      ),
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

  const details = detailsBox([
    { label: "Vendor", value: expense.vendor_name_raw ?? "—" },
    { label: "Total", value: money(expense.total) },
  ]);
  const commentHtml = comment
    ? `<p style="margin:8px 0 0 0; color:#6E5F52;">Comment: ${comment}</p>`
    : "";

  const bodyHtml =
    decision === "approved"
      ? `<p style="margin:0 0 8px 0;">Your expense was <strong style="color:#009C48;">approved</strong> and has moved to Accounts for reimbursement.</p>${details}${commentHtml}`
      : `<p style="margin:0 0 8px 0;"><strong style="color:#4A160A;">Declined</strong> — please contact FMB Procurement Head.</p>${details}${commentHtml}`;

  await sendEmail({
    to: submitter,
    subject: `Expense ${decision} — ${expense.vendor_name_raw ?? "expense"}`,
    html: emailTemplate(bodyHtml),
  });
}

export async function notifyExpensePaid(expense: ExpenseSummary, paymentReference: string | null) {
  const admin = createAdminClient();
  const submitter = await submitterEmail(admin, expense.submitted_by);
  if (!submitter) return;

  const details = detailsBox([
    { label: "Vendor", value: expense.vendor_name_raw ?? "—" },
    { label: "Total", value: money(expense.total) },
    ...(paymentReference ? [{ label: "Reference", value: paymentReference }] : []),
  ]);

  await sendEmail({
    to: submitter,
    subject: `Expense reimbursed — ${expense.vendor_name_raw ?? "expense"} (${money(expense.total)})`,
    html: emailTemplate(`<p style="margin:0 0 8px 0;">Your expense has been paid.</p>${details}`),
  });
}

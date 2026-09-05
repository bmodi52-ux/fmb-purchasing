import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { expenseIdsWithAttachments } from "@/lib/receipt-storage";
import { SubmissionsList } from "./submissions-list";

export default async function MySubmissionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "my_submissions", "view");

  const admin = createAdminClient();
  const { data: expenses } = await admin
    .from("expenses")
    .select(
      "id, expense_number, vendor_name_raw, invoice_number, total, status, submitter_comment, decision_comment, decided_at, payment_reference, payment_date, created_at, receipt_file_path"
    )
    .eq("submitted_by", user.id)
    .order("created_at", { ascending: false });

  // One query for the whole page rather than one per row: the list only
  // needs to know whether to offer a link.
  const withFiles = await expenseIdsWithAttachments(admin, (expenses ?? []).map((e) => e.id));
  const rows = (expenses ?? []).map((e) => ({ ...e, hasReceipt: withFiles.has(e.id) || e.receipt_file_path != null }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">My submissions</h1>
        <p className="page-description mt-1">Track the status of expenses you&apos;ve submitted.</p>
      </div>

      <SubmissionsList expenses={rows} />
    </div>
  );
}

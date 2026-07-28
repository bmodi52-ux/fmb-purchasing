import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { PaymentsTable, type PaymentRow } from "./payments-table";

export default async function PaymentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const admin = createAdminClient();
  const { data: expenses } = await admin
    .from("expenses")
    .select("id, expense_number, vendor_name_raw, invoice_number, total, decided_at, submitted_by, receipt_file_path")
    .eq("status", "approved")
    .order("decided_at");

  const submitterIds = [...new Set((expenses ?? []).map((e) => e.submitted_by))];
  const { data: profiles } = submitterIds.length
    ? await admin.from("profiles").select("id, full_name, username").in("id", submitterIds)
    : { data: [] };
  const submitterNameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.username]));

  const rows: PaymentRow[] = (expenses ?? []).map((e) => ({
    id: e.id,
    expense_number: e.expense_number,
    vendor_name_raw: e.vendor_name_raw,
    invoice_number: e.invoice_number,
    total: e.total,
    decided_at: e.decided_at,
    submittedByName: submitterNameById.get(e.submitted_by) ?? "—",
    hasReceipt: e.receipt_file_path != null,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">Payments</h1>
        <p className="mt-1 text-ink/70">
          Approved expenses ready for reimbursement. Mark paid once the bank transfer is complete — this is a
          record-keeping step only, no payment is processed here.
        </p>
      </div>

      <PaymentsTable expenses={rows} />
    </div>
  );
}

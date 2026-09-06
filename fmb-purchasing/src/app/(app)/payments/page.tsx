import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { expenseIdsWithAttachments } from "@/lib/receipt-storage";
import { PaymentsTable, type PaymentRow } from "./payments-table";

export default async function PaymentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const admin = createAdminClient();
  const { data: expenses } = await admin
    .from("expenses")
    .select("id, expense_number, vendor_name_raw, invoice_number, total, decided_at, submitted_by")
    .eq("status", "approved")
    .order("decided_at");

  const submitterIds = [...new Set((expenses ?? []).map((e) => e.submitted_by))];
  const { data: profiles } = submitterIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", submitterIds)
    : { data: [] };
  const submitterNameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));

  // One query for the whole page rather than one per row: the list only
  // needs to know whether to offer a link.
  const withFiles = await expenseIdsWithAttachments(admin, (expenses ?? []).map((e) => e.id));
  const rows: PaymentRow[] = (expenses ?? []).map((e) => ({
    id: e.id,
    expense_number: e.expense_number,
    vendor_name_raw: e.vendor_name_raw,
    invoice_number: e.invoice_number,
    total: e.total,
    decided_at: e.decided_at,
    submittedByName: submitterNameById.get(e.submitted_by) ?? "—",
    hasReceipt: withFiles.has(e.id),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">Payments</h1>
        <p className="page-description mt-1">
          Approved expenses ready for reimbursement. Mark paid once the bank transfer is complete — this is a
          record-keeping step only, no payment is processed here.
        </p>
      </div>

      <PaymentsTable expenses={rows} />
    </div>
  );
}

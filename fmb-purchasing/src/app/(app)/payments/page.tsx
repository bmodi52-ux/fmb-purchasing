import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { expenseIdsWithAttachments } from "@/lib/receipt-storage";
import { formatAccount, paymentInstructions } from "@/lib/payment-instruction";
import { PaymentsTable, type PaymentRow } from "./payments-table";
import { getSetting } from "@/lib/app-settings";
import { duplicateLabel, possibleDuplicates, type DuplicateMatch } from "@/lib/duplicates";

export const metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const admin = createAdminClient();
  const { data: expenses } = await admin
    .from("expenses")
    .select("id, expense_number, vendor_id, vendor_name_raw, invoice_number, total, decided_at, submitted_by, payee_id")
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

  // Everyone on this page holds payments:mark_paid — the page requires it
  // above — so the account numbers are theirs to see. This is the point at
  // which the transfer is made, and the only place an unconfirmed account
  // could still be caught.
  const instructions = await paymentInstructions(admin, expenses ?? [], { canSeeBankDetails: true });

  // The last point a double payment can be stopped (#21).
  const duplicates = (await getSetting(admin, "duplicate_flags_for_reviewers"))
    ? await possibleDuplicates(admin, expenses ?? [])
    : new Map<string, DuplicateMatch[]>();

  const rows: PaymentRow[] = (expenses ?? []).map((e) => ({
    id: e.id,
    expense_number: e.expense_number,
    vendor_name_raw: e.vendor_name_raw,
    invoice_number: e.invoice_number,
    total: e.total,
    decided_at: e.decided_at,
    submittedByName: submitterNameById.get(e.submitted_by) ?? "—",
    hasReceipt: withFiles.has(e.id),
    duplicateWarning: duplicates.get(e.id)?.length ? duplicateLabel(duplicates.get(e.id)!) : null,
    payment: instructions.get(e.id) ?? null,
    // Flattened alongside the object so a payment run exports as text: a
    // spreadsheet of transfers to make is worth as much as the screen, and it
    // must carry the unconfirmed marker with it rather than losing it in the
    // conversion.
    payeeName: instructions.get(e.id)?.displayName ?? "—",
    payeeAccount: (() => {
      const found = instructions.get(e.id);
      return found ? formatAccount(found) : "—";
    })(),
    payeeConfirmed: instructions.get(e.id)?.status === "pending" ? "Unconfirmed" : "",
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

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { allRows } from "@/lib/supabase/all-rows";
import { expenseIdsWithAttachments } from "@/lib/receipt-storage";
import { formatAccount, paymentInstructions } from "@/lib/payment-instruction";
import { PaymentsTable, type PaymentRow } from "./payments-table";
import { getSetting } from "@/lib/app-settings";
import { duplicateLabel, possibleDuplicates, type DuplicateMatch } from "@/lib/duplicates";

export const metadata = { title: "Payments" };

type ApprovedExpense = {
  id: string;
  expense_number: string | null;
  vendor_id: string | null;
  vendor_name_raw: string | null;
  invoice_number: string | null;
  total: number;
  decided_at: string | null;
  submitted_by: string;
  payee_id: string | null;
};

/** Whole days since an instant — how long the oldest approval has waited. */
function daysSince(instant: string): number {
  return Math.floor((Date.now() - new Date(instant).getTime()) / 86_400_000);
}

export default async function PaymentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "payments", "mark_paid");

  const admin = createAdminClient();
  // Paged: a response stops at 1,000 rows without saying so, and an approved
  // expense missing from this list is one nobody gets reminded to pay.
  const expenses = await allRows<ApprovedExpense>((from, to) =>
    admin
      .from("expenses")
      .select("id, expense_number, vendor_id, vendor_name_raw, invoice_number, total, decided_at, submitted_by, payee_id")
      .eq("status", "approved")
      .order("decided_at")
      .order("id")
      .range(from, to)
  );

  const submitterIds = [...new Set(expenses.map((e) => e.submitted_by))];
  const { data: profiles } = submitterIds.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", submitterIds)
    : { data: [] };
  const submitterNameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));

  // One query for the whole page rather than one per row: the list only
  // needs to know whether to offer a link.
  const withFiles = await expenseIdsWithAttachments(admin, expenses.map((e) => e.id));

  // Everyone on this page holds payments:mark_paid — the page requires it
  // above — so the account numbers are theirs to see. This is the point at
  // which the transfer is made, and the only place an unconfirmed account
  // could still be caught.
  const instructions = await paymentInstructions(admin, expenses, { canSeeBankDetails: true });

  // The last point a double payment can be stopped (#21).
  const duplicates = (await getSetting(admin, "duplicate_flags_for_reviewers"))
    ? await possibleDuplicates(admin, expenses)
    : new Map<string, DuplicateMatch[]>();

  const rows: PaymentRow[] = expenses.map((e) => ({
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

  const unpaidTotal = expenses.reduce((s, e) => s + Number(e.total), 0);
  const oldestApproved = expenses[0]?.decided_at as string | undefined;
  const oldestDays = oldestApproved ? daysSince(oldestApproved) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title text-ink">Payments</h1>
          <p className="page-description mt-1 max-w-2xl">
            Approved expenses waiting to be paid, oldest approval first.
            {expenses.length > 0 &&
              ` ${expenses.length} · ${unpaidTotal.toLocaleString("en-AU", { style: "currency", currency: "AUD" })} · oldest approved ${oldestDays < 1 ? "today" : `${oldestDays} ${oldestDays === 1 ? "day" : "days"} ago`}.`}{" "}
            Download a bank file, then mark them paid — no money moves from here.
          </p>
        </div>
        <a
          href="/payments/reconcile"
          className="btn btn-secondary self-start"
        >
          Check against a bank statement
        </a>
      </div>

      <PaymentsTable expenses={rows} />
    </div>
  );
}

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getColumnPreference } from "@/lib/column-prefs";
import { ExpensesTable, type ExpenseRow } from "./expenses-table";

const PAGE_KEY = "all_expenses";
const DEFAULT_VISIBLE = [
  "expense_number",
  "vendor",
  "submitted_by",
  "status",
  "invoice_number",
  "receipt",
  "total",
  "created_at",
];

export default async function AllExpensesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "all_expenses", "view");

  const admin = createAdminClient();
  const { data: expenses } = await admin
    .from("expenses")
    .select(
      "id, expense_number, vendor_id, vendor_name_raw, submitted_by, status, invoice_number, receipt_date, receipt_file_path, subtotal, gst_amount, total, fiscal_year_hijri, decided_by, decided_at, payment_reference, payment_date, created_at"
    )
    .order("created_at", { ascending: false });

  const userIds = [
    ...new Set((expenses ?? []).flatMap((e) => [e.submitted_by, e.decided_by].filter(Boolean) as string[])),
  ];
  const vendorIds = [...new Set((expenses ?? []).map((e) => e.vendor_id).filter(Boolean) as string[])];

  const [{ data: profiles }, { data: vendors }, visibleColumns] = await Promise.all([
    userIds.length ? admin.from("profiles").select("id, full_name, username").in("id", userIds) : { data: [] },
    vendorIds.length ? admin.from("vendors").select("id, vendor_number").in("id", vendorIds) : { data: [] },
    getColumnPreference(user.id, PAGE_KEY, DEFAULT_VISIBLE),
  ]);

  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.username]));
  const vendorNumberById = new Map((vendors ?? []).map((v) => [v.id, v.vendor_number]));

  const rows: ExpenseRow[] = (expenses ?? []).map((e) => ({
    id: e.id,
    expenseNumber: e.expense_number,
    vendor_name_raw: e.vendor_name_raw,
    vendorNumber: e.vendor_id ? (vendorNumberById.get(e.vendor_id) ?? null) : null,
    submittedByName: nameById.get(e.submitted_by) ?? "—",
    status: e.status,
    invoice_number: e.invoice_number,
    receipt_date: e.receipt_date,
    hasReceipt: e.receipt_file_path != null,
    subtotal: e.subtotal,
    gst_amount: e.gst_amount,
    total: e.total,
    fiscal_year_hijri: e.fiscal_year_hijri,
    decidedByName: e.decided_by ? (nameById.get(e.decided_by) ?? null) : null,
    decided_at: e.decided_at,
    payment_reference: e.payment_reference,
    payment_date: e.payment_date,
    created_at: e.created_at,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold text-ink">All expenses</h1>
        <p className="mt-1 text-ink/70">Every expense across FMB, with status, category, vendor, amounts, and GST breakdown.</p>
      </div>

      <ExpensesTable rows={rows} initialVisible={visibleColumns} />
    </div>
  );
}

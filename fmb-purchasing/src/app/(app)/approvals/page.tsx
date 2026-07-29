import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApprovalsList, type ApprovalRow } from "./approvals-list";
import { categoryLabelsById } from "@/lib/categories";

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "approvals", "approve");

  const admin = createAdminClient();
  const { data: expenses } = await admin
    .from("expenses")
    .select("id, expense_number, vendor_name_raw, invoice_number, receipt_date, receipt_file_path, subtotal, gst_amount, total, submitted_by, created_at")
    .eq("status", "submitted")
    .order("created_at");

  if (!expenses || expenses.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="page-title text-ink">Approvals</h1>
        <p className="text-sm text-ink/50">Nothing waiting for review.</p>
      </div>
    );
  }

  const submitterIds = [...new Set(expenses.map((e) => e.submitted_by))];
  const expenseIds = expenses.map((e) => e.id);

  const [{ data: profiles }, { data: lineItems }] = await Promise.all([
    admin.from("profiles").select("id, full_name, email").in("id", submitterIds),
    admin
      .from("expense_line_items")
      .select("expense_id, description_raw, quantity, unit_price, line_total, category_id")
      .in("expense_id", expenseIds),
  ]);
  const submitterNameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));

  const { data: categories } = await admin.from("categories").select("id, name, parent_category_id");
  const categoryNameById = categoryLabelsById(categories ?? []);

  const itemsByExpense = new Map<string, typeof lineItems>();
  for (const li of lineItems ?? []) {
    const list = itemsByExpense.get(li.expense_id) ?? [];
    list.push(li);
    itemsByExpense.set(li.expense_id, list);
  }

  const rows: ApprovalRow[] = expenses.map((e) => ({
    id: e.id,
    expense_number: e.expense_number,
    vendor_name_raw: e.vendor_name_raw,
    invoice_number: e.invoice_number,
    receipt_date: e.receipt_date,
    subtotal: e.subtotal,
    gst_amount: e.gst_amount,
    total: e.total,
    submittedByName: submitterNameById.get(e.submitted_by) ?? "—",
    created_at: e.created_at,
    hasReceipt: e.receipt_file_path != null,
    lineItems: (itemsByExpense.get(e.id) ?? []).map((li) => ({
      description_raw: li.description_raw,
      categoryName: li.category_id ? (categoryNameById.get(li.category_id) ?? "—") : "—",
      quantity: li.quantity,
      unit_price: li.unit_price,
      line_total: li.line_total,
    })),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">Approvals</h1>
        <p className="page-description mt-1">{expenses.length} expense(s) waiting for review.</p>
      </div>

      <ApprovalsList expenses={rows} />
    </div>
  );
}

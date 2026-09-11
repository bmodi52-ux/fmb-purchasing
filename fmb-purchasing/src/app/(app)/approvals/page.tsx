import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApprovalsList, type ApprovalRow } from "./approvals-list";
import { categoryLabelsById } from "@/lib/categories";
import { expenseIdsWithAttachments } from "@/lib/receipt-storage";
import { paymentInstructions } from "@/lib/payment-instruction";

export const metadata = { title: "Approvals" };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/** "today", "1 day", "5 days" — how long the oldest submission has waited. */
function waitingFor(createdAt: string): string {
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  if (days < 1) return "since today";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "approvals", "approve");

  const admin = createAdminClient();
  const [{ data: expenses }, permissions] = await Promise.all([
    admin
      .from("expenses")
      .select(
        "id, expense_number, vendor_id, vendor_name_raw, invoice_number, receipt_date, subtotal, gst_amount, total, submitted_by, submitter_comment, payee_id, created_at"
      )
      .eq("status", "submitted")
      .order("created_at"),
    getUserPermissions(user.teamIds),
  ]);

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
  const vendorIds = [...new Set(expenses.map((e) => e.vendor_id).filter(Boolean))] as string[];

  const [{ data: profiles }, { data: lineItems }, { data: categories }, { data: vendors }, instructions, withFiles] =
    await Promise.all([
      admin.from("profiles").select("id, full_name, email").in("id", submitterIds),
      admin
        .from("expense_line_items")
        .select("expense_id, description_raw, quantity, unit_price, line_total, category_id, pricelist_item_id")
        .in("expense_id", expenseIds)
        .order("sort_order"),
      admin.from("categories").select("id, name, parent_category_id"),
      vendorIds.length
        ? admin.from("vendors").select("id, status").in("id", vendorIds)
        : Promise.resolve({ data: [] as { id: string; status: string }[] }),
      // Whether each payee's account has been confirmed — the same check the
      // Payments run makes, asked here so it can be noticed before approving.
      paymentInstructions(admin, expenses, { canSeeBankDetails: can(permissions, "payments", "mark_paid") }),
      // One query for the whole page rather than one per row.
      expenseIdsWithAttachments(admin, expenseIds),
    ]);

  // Lines whose Pricelist item was created by this receipt and nobody has
  // reviewed yet — approving the expense is a good moment to notice them.
  const offerIds = [...new Set((lineItems ?? []).map((l) => l.pricelist_item_id).filter(Boolean))] as string[];
  const { data: offers } = offerIds.length
    ? await admin.from("pricelist_items").select("id, item_pack_sizes ( items ( status ) )").in("id", offerIds)
    : { data: [] };
  const newItemOfferIds = new Set(
    (offers ?? [])
      .filter(
        (o) =>
          (o.item_pack_sizes as unknown as { items: { status: string } | null } | null)?.items?.status === "pending"
      )
      .map((o) => o.id as string)
  );

  const submitterNameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));
  const categoryNameById = categoryLabelsById(categories ?? []);
  const pendingVendorIds = new Set(
    ((vendors ?? []) as { id: string; status: string }[]).filter((v) => v.status === "pending").map((v) => v.id)
  );

  const itemsByExpense = new Map<string, NonNullable<typeof lineItems>>();
  for (const li of lineItems ?? []) {
    const list = itemsByExpense.get(li.expense_id) ?? [];
    list.push(li);
    itemsByExpense.set(li.expense_id, list);
  }

  const rows: ApprovalRow[] = expenses.map((e) => {
    const lines = itemsByExpense.get(e.id) ?? [];
    return {
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
      hasReceipt: withFiles.has(e.id),
      submitterComment: e.submitter_comment,
      flags: {
        newVendor: e.vendor_id ? pendingVendorIds.has(e.vendor_id) : false,
        unconfirmedAccount: instructions.get(e.id)?.status === "pending",
        newItems: lines.filter((l) => l.pricelist_item_id && newItemOfferIds.has(l.pricelist_item_id)).length,
      },
      lineItems: lines.map((li) => ({
        description_raw: li.description_raw,
        categoryName: li.category_id ? (categoryNameById.get(li.category_id) ?? "—") : "—",
        quantity: li.quantity,
        unit_price: li.unit_price,
        line_total: li.line_total,
      })),
    };
  });

  const waitingTotal = expenses.reduce((sum, e) => sum + Number(e.total), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">Approvals</h1>
        {/* How big the queue is and how long it has waited, before reading any
            of it. Ordered oldest first, so the first row is the oldest. */}
        <p className="page-description mt-1">
          {expenses.length} {expenses.length === 1 ? "expense" : "expenses"} · {money(waitingTotal)} · oldest waiting{" "}
          {waitingFor(expenses[0]!.created_at)}
        </p>
      </div>

      {/* The submitter's name only earns its place when there is more than one. */}
      <ApprovalsList expenses={rows} showSubmitter={submitterIds.length > 1} />
    </div>
  );
}

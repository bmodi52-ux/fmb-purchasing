import type { createAdminClient } from "@/lib/supabase/admin";
import { expenseIdsWithAttachments } from "@/lib/receipt-storage";
import { formatUnitCost } from "@/lib/pack-description";
import type { PurchaseRow } from "./purchases-table";

type Admin = ReturnType<typeof createAdminClient>;

type LineWithExpense = {
  id: string;
  expense_id: string;
  pricelist_item_id: string;
  description_raw: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  expenses: {
    expense_number: string | null;
    receipt_date: string | null;
    created_at: string;
    status: string;
    vendor_name_raw: string | null;
    invoice_number: string | null;
    submitted_by: string;
  };
};

/**
 * The receipt lines filed against an item's offers, newest first.
 *
 * Withdrawn expenses are left out, as they are from the expense ledger: they
 * were taken back before anyone decided them. Declined ones stay, marked, so
 * a line that went nowhere can still be traced.
 */
export async function loadPurchaseRows(
  admin: Admin,
  {
    itemId,
    offers,
    packLabelByOfferId,
    canOpenExpense,
  }: {
    itemId: string;
    offers: { id: string }[];
    packLabelByOfferId: Map<string, string>;
    canOpenExpense: (expenseId: string, submittedBy: string) => boolean;
  }
): Promise<PurchaseRow[]> {
  const offerIds = offers.map((o) => o.id);
  if (offerIds.length === 0) return [];

  const [{ data: lineData, error }, { data: costRows }] = await Promise.all([
    admin
      .from("expense_line_items")
      .select(
        "id, expense_id, pricelist_item_id, description_raw, quantity, unit_price, line_total, " +
          "expenses!inner(expense_number, receipt_date, created_at, status, vendor_name_raw, invoice_number, submitted_by)"
      )
      .in("pricelist_item_id", offerIds)
      .neq("expenses.status", "withdrawn"),
    admin
      .from("item_paid_unit_costs")
      .select("line_item_id, cost_per_base_unit, base_unit_code, pack_disagrees")
      .eq("item_id", itemId),
  ]);
  if (error) throw error;
  const lines = (lineData ?? []) as unknown as LineWithExpense[];

  const costByLine = new Map(
    (costRows ?? []).map((c) => [
      c.line_item_id as string,
      {
        cost: c.cost_per_base_unit == null ? null : Number(c.cost_per_base_unit),
        unit: c.base_unit_code as string,
        disagrees: Boolean(c.pack_disagrees),
      },
    ])
  );

  const submitterIds = [...new Set(lines.map((l) => l.expenses.submitted_by))];
  const [{ data: profiles }, withFiles] = await Promise.all([
    submitterIds.length
      ? admin.from("profiles").select("id, full_name, email").in("id", submitterIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
    expenseIdsWithAttachments(admin, [...new Set(lines.map((l) => l.expense_id))]),
  ]);
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));

  return lines
    .map((l): PurchaseRow => {
      const e = l.expenses;
      const cost = costByLine.get(l.id);
      // A line whose pack and receipt disagree by five times or more is kept
      // out of every cost figure (0066), so it isn't given one here either.
      const costValue = cost && !cost.disagrees ? cost.cost : null;
      return {
        id: l.id,
        expenseId: l.expense_id,
        expenseNumber: e.expense_number,
        canOpen: canOpenExpense(l.expense_id, e.submitted_by),
        hasReceipt: withFiles.has(l.expense_id),
        receiptDate: e.receipt_date ?? e.created_at.slice(0, 10),
        vendorName: e.vendor_name_raw ?? "—",
        invoiceNumber: e.invoice_number,
        description: l.description_raw ?? "",
        packLabel: packLabelByOfferId.get(l.pricelist_item_id) ?? "—",
        quantity: l.quantity == null ? null : Number(l.quantity),
        unitPrice: l.unit_price == null ? null : Number(l.unit_price),
        lineTotal: Number(l.line_total ?? 0),
        costPerUnit: costValue == null ? null : formatUnitCost(costValue, cost!.unit),
        costPerUnitValue: costValue,
        status: e.status,
        submittedByName: nameById.get(e.submitted_by) ?? "—",
      };
    })
    .sort((a, b) => (b.receiptDate ?? "").localeCompare(a.receiptDate ?? ""));
}

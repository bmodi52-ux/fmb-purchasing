import { createAdminClient } from "@/lib/supabase/admin";
import { categoryLabelsById } from "@/lib/categories";
import { type ExpenseRecord, type LineRecord } from "./aggregate";

export type PaidCostRow = {
  item_id: string;
  item_name: string;
  expense_id: string;
  receipt_date: string | null;
  base_quantity: number;
  base_unit_code: string;
  cost_per_base_unit: number;
};

export type ReportRawData = {
  allExpenses: ExpenseRecord[];
  allLines: LineRecord[];
  paidCosts: PaidCostRow[];
  fyOf: Map<string, number>;
};

/**
 * Expenses/lines/paid-costs for a set of fiscal years, mapped into the
 * shapes aggregate.ts expects. Shared by the Reports page (which always asks
 * for the selected year plus the prior one, for the built-in comparison) and
 * the home dashboard (which asks for whichever distinct years its saved
 * widgets need — one fetch per distinct year, not one per widget).
 */
export async function loadReportRawData(fiscalYears: number[]): Promise<ReportRawData> {
  const admin = createAdminClient();
  const years = [...new Set(fiscalYears)];

  const [{ data: rawExpenses }, { data: categoryRows }, { data: vendorRows }] = await Promise.all([
    admin
      .from("expenses")
      .select(
        "id, expense_number, vendor_id, vendor_name_raw, status, receipt_date, created_at, total, gst_amount, fiscal_year_hijri"
      )
      .in("fiscal_year_hijri", years)
      .neq("status", "declined"),
    admin.from("categories").select("id, name, parent_category_id"),
    admin.from("vendors").select("id, name"),
  ]);

  const expenseIds = (rawExpenses ?? []).map((e) => e.id);

  const [{ data: rawLines }, { data: paidCosts }] = expenseIds.length
    ? await Promise.all([
        // The item name is three tables up from a line — line → offer → pack
        // size → item — so it rides along as a nested embed rather than
        // costing another wave of queries.
        admin
          .from("expense_line_items")
          .select(
            "expense_id, category_id, line_total, quantity, description_raw, pricelist_item_id, pricelist_items ( item_pack_sizes ( items ( id, name ) ) )"
          )
          .in("expense_id", expenseIds),
        admin
          .from("item_paid_unit_costs")
          .select(
            "item_id, item_name, expense_id, receipt_date, base_quantity, base_unit_code, cost_per_base_unit"
          )
          .in("expense_id", expenseIds),
      ])
    : [{ data: [] }, { data: [] }];

  const categoryNameById = categoryLabelsById(categoryRows ?? []);
  const vendorNameById = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));

  const allExpenses: ExpenseRecord[] = (rawExpenses ?? []).map((e) => ({
    id: e.id,
    expenseNumber: e.expense_number,
    vendorId: e.vendor_id,
    vendorName:
      (e.vendor_id ? vendorNameById.get(e.vendor_id) : null) ?? e.vendor_name_raw ?? "Unrecorded vendor",
    status: e.status,
    receiptDate: e.receipt_date,
    createdAt: e.created_at,
    total: Number(e.total),
    gst: Number(e.gst_amount),
  }));

  const fyOf = new Map((rawExpenses ?? []).map((e) => [e.id, e.fiscal_year_hijri]));

  const allLines: LineRecord[] = (rawLines ?? []).map((l) => {
    const offer = l.pricelist_items as unknown as
      | { item_pack_sizes: { items: { id: string; name: string } | null } | null }
      | null;
    const item = offer?.item_pack_sizes?.items ?? null;
    return {
      expenseId: l.expense_id,
      categoryId: l.category_id,
      categoryName: l.category_id
        ? (categoryNameById.get(l.category_id) ?? "Uncategorised")
        : "Uncategorised",
      itemId: item?.id ?? null,
      // Falls back to what the receipt said, so an unmatched line still shows
      // up under a name a person recognises rather than vanishing.
      itemName: item?.name ?? l.description_raw,
      lineTotal: Number(l.line_total),
      quantity: l.quantity == null ? null : Number(l.quantity),
    };
  });

  return {
    allExpenses,
    allLines,
    paidCosts: (paidCosts ?? []) as PaidCostRow[],
    fyOf,
  };
}

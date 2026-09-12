import type { SupabaseClient } from "@supabase/supabase-js";
import { allRows } from "@/lib/supabase/all-rows";
import { expenseDateFilter } from "@/lib/periods-data";
import type { GstExpense, GstLine } from "@/lib/gst-summary";
import type { XeroBillLine } from "@/lib/xero-export";

/**
 * The expenses and lines behind the Accounting page for a period (#38).
 *
 * Two ways to decide which expenses a period holds, because FMB's GST basis is
 * still to be confirmed:
 *
 *   receipt  approved or paid, dated in the period by receipt (accruals)
 *   paid     paid, with the payment dated in the period (cash)
 */

export type Basis = "receipt" | "paid";

type ExpenseRow = {
  id: string;
  expense_number: string | null;
  vendor_id: string | null;
  vendor_name_raw: string | null;
  invoice_number: string | null;
  receipt_date: string | null;
  created_at: string;
  decided_at: string | null;
  payment_date: string | null;
  total: number;
  gst_amount: number;
};

type LineRow = {
  id: string;
  expense_id: string;
  category_id: string | null;
  description_raw: string;
  line_total: number;
  line_gst: number | null;
  gst_applicable: boolean | null;
  is_capital: boolean;
};

const CHUNK = 150;

async function chunked<T>(ids: string[], page: (ids: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    out.push(...(await allRows<T>((from, to) => page(slice, from, to))));
  }
  return out;
}

export async function loadAccountingPeriod(
  admin: SupabaseClient,
  range: { start: string; end: string },
  basis: Basis
): Promise<{ gstExpenses: GstExpense[]; gstLines: GstLine[]; xeroLines: XeroBillLine[] }> {
  const expenses = await allRows<ExpenseRow>((from, to) => {
    let q = admin
      .from("expenses")
      .select("id, expense_number, vendor_id, vendor_name_raw, invoice_number, receipt_date, created_at, decided_at, payment_date, total, gst_amount")
      .order("id")
      .range(from, to);
    q =
      basis === "paid"
        ? q.eq("status", "paid").gte("payment_date", range.start).lte("payment_date", range.end)
        : q.in("status", ["approved", "paid"]).or(expenseDateFilter(range.start, range.end));
    return q;
  });
  const ids = expenses.map((e) => e.id);

  const vendorIds = [...new Set(expenses.map((e) => e.vendor_id).filter(Boolean) as string[])];
  const [lines, attachments, vendors, { data: categories }, { data: locks }] = await Promise.all([
    chunked<LineRow>(ids, (slice, from, to) =>
      admin
        .from("expense_line_items")
        .select("id, expense_id, category_id, description_raw, line_total, line_gst, gst_applicable, is_capital")
        .in("expense_id", slice)
        .order("id")
        .range(from, to)
    ),
    chunked<{ expense_id: string; id: string }>(ids, (slice, from, to) =>
      admin.from("expense_attachments").select("id, expense_id").in("expense_id", slice).order("id").range(from, to)
    ),
    chunked<{ id: string; name: string; abn: string | null; gst_registered: boolean | null }>(vendorIds, (slice, from, to) =>
      admin.from("vendors").select("id, name, abn, gst_registered").in("id", slice).order("id").range(from, to)
    ),
    admin.from("categories").select("id, name, parent_category_id, account_code"),
    admin.from("locked_periods").select("start_date, end_date, locked_at").is("unlocked_at", null),
  ]);

  const withFiles = new Set(attachments.map((a) => a.expense_id));
  const vendorById = new Map(vendors.map((v) => [v.id, v]));
  const accountCode = new Map((categories ?? []).map((c) => [c.id as string, (c.account_code as string | null) ?? null]));

  const gstExpenses: GstExpense[] = expenses.map((e) => {
    const date = e.receipt_date ?? e.created_at.slice(0, 10);
    const vendor = e.vendor_id ? vendorById.get(e.vendor_id) : undefined;
    return {
      id: e.id,
      expenseNumber: e.expense_number,
      vendorName: vendor?.name ?? e.vendor_name_raw ?? "Unrecorded vendor",
      total: Number(e.total),
      gst: Number(e.gst_amount),
      hasAttachment: withFiles.has(e.id),
      vendorAbn: vendor?.abn ?? null,
      vendorGstRegistered: vendor?.gst_registered ?? null,
      lateForLockedPeriod: (locks ?? []).some(
        (l) => date >= (l.start_date as string) && date <= (l.end_date as string) && !!e.decided_at && e.decided_at > (l.locked_at as string)
      ),
    };
  });

  const gstLines: GstLine[] = lines.map((l) => ({
    expenseId: l.expense_id,
    lineTotal: Number(l.line_total),
    gst: Number(l.line_gst ?? 0),
    isCapital: l.is_capital,
    gstApportioned: l.gst_applicable == null,
  }));

  const expenseById = new Map(expenses.map((e) => [e.id, e]));
  const xeroLines: XeroBillLine[] = lines.map((l) => {
    const e = expenseById.get(l.expense_id)!;
    const date = e.receipt_date ?? e.created_at.slice(0, 10);
    return {
      expenseNumber: e.expense_number,
      invoiceNumber: e.invoice_number,
      contactName: (e.vendor_id ? vendorById.get(e.vendor_id)?.name : null) ?? e.vendor_name_raw ?? "Unrecorded vendor",
      invoiceDate: date,
      dueDate: e.payment_date ?? date,
      description: l.description_raw,
      lineTotal: Number(l.line_total),
      gst: Number(l.line_gst ?? 0),
      isCapital: l.is_capital,
      accountCode: l.category_id ? (accountCode.get(l.category_id) ?? null) : null,
    };
  });

  return { gstExpenses, gstLines, xeroLines };
}

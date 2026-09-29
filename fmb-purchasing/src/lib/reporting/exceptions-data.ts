import type { SupabaseClient } from "@supabase/supabase-js";
import { matchDuplicates } from "@/lib/duplicates";
import { NOT_SPEND_FILTER } from "@/lib/expense-status";
import { parsePeriod, type Period } from "@/lib/periods";
import { allRows, allRowsForIds } from "@/lib/supabase/all-rows";
import { vendorLabel } from "@/lib/vendor-names";
import { describeBasis, statusesFor } from "./basis.ts";
import { exceptionTables, findExceptions, type DateConcern, type Exceptions } from "./exceptions.ts";
import { safeFilename, type ReportDocument } from "./tables.ts";

/**
 * Loading a period's exceptions (exceptions.ts), for the page and its
 * download alike. Uncached: it reads columns the spend ledger doesn't carry,
 * and what it reports is what someone is about to go and correct.
 */

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

type ExpenseRow = {
  id: string;
  expense_number: string | null;
  status: string;
  vendor_id: string | null;
  vendor_name_raw: string | null;
  invoice_number: string | null;
  report_date: string;
  total: number | string;
  gst_amount: number | string;
  gst_printed: number | string | null;
  receipt_total: number | string | null;
  receipt_total_scanned: number | string | null;
  receipt_total_note: string | null;
};

type LineRow = {
  id: string;
  expense_id: string;
  kind: string;
  description_raw: string;
  line_total: number | string;
  line_gst: number | string | null;
  gst_applicable: boolean | null;
  not_on_receipt: boolean;
  not_on_receipt_note: string | null;
  category_id: string | null;
};

type AttachmentRow = { id: string; expense_id: string; sha256: string };
type OtherExpense = { id: string; expense_number: string | null; status: string; vendor_id?: string | null; invoice_number?: string | null };

const num = (v: number | string | null) => (v == null ? null : Number(v));

// A sha256 is 64 characters, so fewer of them fit in a URL than ids do.
const SHA_CHUNK = 60;

export type ExceptionsView = { period: Period; report: Exceptions };

export async function loadExceptionsView(admin: SupabaseClient, params: Params, today: string): Promise<ExceptionsView> {
  const period = parsePeriod(one(params.period), today);

  const expenseRows = await allRows<ExpenseRow>((from, to) =>
    admin
      .from("expenses")
      .select(
        "id, expense_number, status, vendor_id, vendor_name_raw, invoice_number, report_date, total, gst_amount, gst_printed, receipt_total, receipt_total_scanned, receipt_total_note"
      )
      .in("status", [...statusesFor("committed")])
      .gte("report_date", period.start)
      .lte("report_date", period.end)
      .order("id")
      .range(from, to)
  );
  const ids = expenseRows.map((e) => e.id);
  const vendorIds = [...new Set(expenseRows.map((e) => e.vendor_id).filter(Boolean) as string[])];

  const [vendors, lines, categories, packs, dates, ownAttachments, invoiceRows] = await Promise.all([
    allRowsForIds<{ id: string; name: string }>(vendorIds, (slice, from, to) =>
      admin.from("vendors").select("id, name").in("id", slice).order("id").range(from, to)
    ),
    allRowsForIds<LineRow>(ids, (slice, from, to) =>
      admin
        .from("expense_line_items")
        .select("id, expense_id, kind, description_raw, line_total, line_gst, gst_applicable, not_on_receipt, not_on_receipt_note, category_id")
        .in("expense_id", slice)
        .order("id")
        .range(from, to)
    ),
    allRows<{ id: string; name: string; parent_category_id: string | null }>((from, to) =>
      admin.from("categories").select("id, name, parent_category_id").order("id").range(from, to)
    ),
    allRowsForIds<{ expense_id: string; item_name: string; line_total: number | string; cost_per_base_unit: number | string; base_unit_code: string }>(
      ids,
      (slice, from, to) =>
        admin
          .from("item_paid_unit_costs")
          .select("line_item_id, expense_id, item_name, line_total, cost_per_base_unit, base_unit_code")
          .eq("pack_disagrees", true)
          .in("expense_id", slice)
          .order("line_item_id")
          .range(from, to)
    ),
    // Every date concern, not just this period's: a misread date can put an
    // expense submitted in the period far outside it (0084).
    allRows<{
      expense_id: string;
      expense_number: string | null;
      status: string;
      vendor_name_raw: string | null;
      total: number | string;
      receipt_date: string;
      submitted_on: string;
      concern: DateConcern["concern"];
    }>((from, to) =>
      admin
        .from("expense_date_checks")
        .select("expense_id, expense_number, status, vendor_name_raw, total, receipt_date, submitted_on, concern")
        .not("concern", "is", null)
        .not("status", "in", NOT_SPEND_FILTER)
        .order("expense_id")
        .range(from, to)
    ),
    allRowsForIds<AttachmentRow>(ids, (slice, from, to) =>
      admin
        .from("expense_attachments")
        .select("id, expense_id, sha256")
        .in("expense_id", slice)
        .not("sha256", "is", null)
        .order("id")
        .range(from, to)
    ),
    // The duplicate rule (lib/duplicates) asks after every expense that counts
    // as spend, whenever it was dated — a double claim a year apart is still one.
    allRows<OtherExpense>((from, to) =>
      admin
        .from("expenses")
        .select("id, expense_number, status, vendor_id, invoice_number")
        .not("vendor_id", "is", null)
        .not("invoice_number", "is", null)
        .not("status", "in", NOT_SPEND_FILTER)
        .order("id")
        .range(from, to)
    ),
  ]);

  const shas = [...new Set(ownAttachments.map((a) => a.sha256))];
  const sameFile = await allRowsForIds<AttachmentRow & { expenses: OtherExpense }>(
    shas,
    (slice, from, to) =>
      admin
        .from("expense_attachments")
        .select("id, expense_id, sha256, expenses!inner ( id, expense_number, status )")
        .in("sha256", slice)
        .not("expenses.status", "in", NOT_SPEND_FILTER)
        .order("id")
        .range(from, to),
    SHA_CHUNK
  );
  const duplicates = matchDuplicates(
    expenseRows,
    ownAttachments,
    sameFile.map((r) => ({ expense_id: r.expense_id, sha256: r.sha256, expense: r.expenses })),
    invoiceRows
  );

  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const expenses = expenseRows.map((e) => ({
    id: e.id,
    entry: e.expense_number,
    vendor: vendorLabel(e.vendor_id ? vendorName.get(e.vendor_id) : null, e.vendor_name_raw),
    status: e.status,
    reportDate: e.report_date,
    total: Number(e.total),
    gst: Number(e.gst_amount),
    gstPrinted: num(e.gst_printed),
    receiptTotal: num(e.receipt_total),
    receiptTotalScanned: num(e.receipt_total_scanned),
    receiptTotalNote: e.receipt_total_note,
  }));
  const vendorOf = new Map(expenses.map((e) => [e.id, e.vendor]));

  const report = findExceptions({
    range: period,
    expenses,
    lines: lines.map((l) => ({
      id: l.id,
      expenseId: l.expense_id,
      kind: l.kind,
      description: l.description_raw,
      lineTotal: Number(l.line_total),
      gst: Number(l.line_gst ?? 0),
      gstApplicable: l.gst_applicable === true,
      notOnReceipt: l.not_on_receipt,
      notOnReceiptNote: l.not_on_receipt_note,
      categoryId: l.category_id,
    })),
    categories,
    disputedPacks: packs.map((p) => ({
      expenseId: p.expense_id,
      itemName: p.item_name,
      lineTotal: Number(p.line_total),
      costPerBaseUnit: Number(p.cost_per_base_unit),
      baseUnit: p.base_unit_code,
    })),
    dateConcerns: dates.map((d) => ({
      expenseId: d.expense_id,
      entry: d.expense_number,
      vendor: vendorOf.get(d.expense_id) ?? vendorLabel(null, d.vendor_name_raw),
      status: d.status,
      total: Number(d.total),
      receiptDate: d.receipt_date,
      submittedOn: d.submitted_on,
      concern: d.concern,
    })),
    duplicates,
  });

  return { period, report };
}

export function exceptionsDocument(view: ExceptionsView): ReportDocument {
  const { period, report } = view;
  return {
    title: `Exceptions — ${period.label}`,
    subtitle: `${period.label} · ${describeBasis("committed")} · ${report.flaggedExpenses} of ${report.expenseCount} expenses have something to check`,
    filenameBase: safeFilename(`exceptions-${period.code}`),
    tables: exceptionTables(report),
  };
}

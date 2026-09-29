/**
 * The ledger every report reads, and the pure work of building it.
 *
 * lib/reporting/ledger.ts fetches rows and caches them; everything here is
 * what those rows become, with no database and no framework, so it can be
 * tested against rows Postgres itself produced (reconciliation.test.ts).
 *
 * Before this, Reports, Budgets and the home widgets read one loader and
 * Accounting another, each naming vendors and dating expenses its own way.
 * One ledger means one answer to "which vendor was this" and "which period is
 * it in", whichever page asks.
 */

import { categoryLabelsById } from "@/lib/categories";
import { expenseDate, type ExpenseRecord, type LineRecord } from "./aggregate.ts";

/* ------------------------------------------------------------------ */
/* What the database gives                                             */
/* ------------------------------------------------------------------ */

/** Columns read from expenses. */
export type RawExpenseRow = {
  id: string;
  expense_number: string | null;
  vendor_id: string | null;
  vendor_name_raw: string | null;
  invoice_number: string | null;
  status: string;
  receipt_date: string | null;
  created_at: string;
  report_date: string;
  decided_at: string | null;
  payment_date: string | null;
  payment_run_id: string | null;
  total: number | string;
  gst_amount: number | string;
};

export const EXPENSE_COLUMNS =
  "id, expense_number, vendor_id, vendor_name_raw, invoice_number, status, receipt_date, created_at, report_date, decided_at, payment_date, payment_run_id, total, gst_amount";

/**
 * Columns read from expense_line_items, with the item flattened out of its
 * embed — see flattenLineEmbed. Flat so a cached month stays small.
 */
export type RawLineRow = {
  id: string;
  expense_id: string;
  kind: string;
  category_id: string | null;
  description_raw: string;
  line_total: number | string;
  line_gst: number | string | null;
  gst_applicable: boolean | null;
  quantity: number | string | null;
  is_capital: boolean;
  not_on_receipt: boolean;
  item_id: string | null;
  item_name: string | null;
};

/** The same, as PostgREST returns it with the item three tables up. */
export type EmbeddedLineRow = Omit<RawLineRow, "item_id" | "item_name"> & { pricelist_items: unknown };

export const LINE_COLUMNS =
  "id, expense_id, kind, category_id, description_raw, line_total, line_gst, gst_applicable, quantity, is_capital, not_on_receipt";

/** A line's item sits at line → offer → pack size → item; this lifts it out. */
export function flattenLineEmbed(row: EmbeddedLineRow): RawLineRow {
  const { pricelist_items, ...rest } = row;
  const offer = pricelist_items as { item_pack_sizes: { items: { id: string; name: string } | null } | null } | null;
  const item = offer?.item_pack_sizes?.items ?? null;
  return { ...rest, item_id: item?.id ?? null, item_name: item?.name ?? null };
}

/** One purchase's cost per base unit, from item_paid_unit_costs (0010, 0066). */
export type PaidCostRow = {
  item_id: string;
  item_name: string;
  expense_id: string;
  receipt_date: string | null;
  base_quantity: number;
  base_unit_code: string;
  cost_per_base_unit: number;
  line_total: number;
  /** Packs bought on the line. */
  normalized_quantity: number;
  sold_loose: boolean;
  /**
   * The pack's contents and the receipt disagree by five times or more
   * (0066), so the per-unit figure isn't to be believed. Optional because
   * figures cached before it was read don't carry it.
   */
  pack_disagrees?: boolean;
};

export const UNIT_COST_COLUMNS =
  "item_id, item_name, expense_id, receipt_date, base_quantity, base_unit_code, cost_per_base_unit, line_total, normalized_quantity, sold_loose, pack_disagrees";

export type RawLedgerRows = { expenses: RawExpenseRow[]; lines: RawLineRow[]; unitCosts: PaidCostRow[] };

/** The names a ledger's ids are shown by. Cached apart from the rows, since they change on their own. */
export type Dimensions = {
  categories: { id: string; name: string; parent_category_id: string | null; account_code: string | null }[];
  vendors: { id: string; name: string }[];
};

/* ------------------------------------------------------------------ */
/* What a report reads                                                 */
/* ------------------------------------------------------------------ */

export type ExpenseFact = ExpenseRecord & {
  invoiceNumber: string | null;
  decidedAt: string | null;
  paymentDate: string | null;
  paymentRunId: string | null;
};

export type LineFact = LineRecord & {
  id: string;
  kind: string;
  /** What the receipt said, as entered. */
  description: string;
  isCapital: boolean;
  notOnReceipt: boolean;
};

/**
 * A period's spend: every expense that counts as spend (never declined or
 * withdrawn), its lines, and the per-unit costs behind them.
 */
export type Ledger = { expenses: ExpenseFact[]; lines: LineFact[]; unitCosts: PaidCostRow[] };

export const EMPTY_LEDGER: Ledger = { expenses: [], lines: [], unitCosts: [] };

/** A range of calendar days, inclusive. */
export type DateRange = { start: string; end: string };

/**
 * Rows and names into the ledger. The one place a vendor is named — the
 * vendor's record first, then what the receipt said — and a category given
 * its full "Parent › Child" label.
 */
export function normaliseLedger(rows: RawLedgerRows, dims: Dimensions): Ledger {
  const categoryLabel = categoryLabelsById(dims.categories);
  const vendorName = new Map(dims.vendors.map((v) => [v.id, v.name]));

  const expenses: ExpenseFact[] = rows.expenses.map((e) => ({
    id: e.id,
    expenseNumber: e.expense_number,
    vendorId: e.vendor_id,
    vendorName: (e.vendor_id ? vendorName.get(e.vendor_id) : null) ?? e.vendor_name_raw ?? "Unrecorded vendor",
    status: e.status,
    receiptDate: e.receipt_date,
    createdAt: e.created_at,
    reportDate: e.report_date,
    total: Number(e.total),
    gst: Number(e.gst_amount),
    invoiceNumber: e.invoice_number,
    decidedAt: e.decided_at,
    paymentDate: e.payment_date,
    paymentRunId: e.payment_run_id,
  }));

  const lines: LineFact[] = rows.lines.map((l) => ({
    id: l.id,
    expenseId: l.expense_id,
    kind: l.kind,
    categoryId: l.category_id,
    categoryName: l.category_id ? (categoryLabel.get(l.category_id) ?? "Uncategorised") : "Uncategorised",
    itemId: l.item_id,
    // Falls back to what the receipt said, so an unmatched line still shows
    // up under a name a person recognises rather than vanishing.
    itemName: l.item_name ?? l.description_raw,
    description: l.description_raw,
    lineTotal: Number(l.line_total),
    gst: Number(l.line_gst ?? 0),
    // Null only on lines written before 0026, when GST was shared out.
    gstApportioned: l.gst_applicable == null,
    quantity: l.quantity == null ? null : Number(l.quantity),
    isCapital: l.is_capital,
    notOnReceipt: l.not_on_receipt,
  }));

  return { expenses, lines, unitCosts: rows.unitCosts };
}

/** Several loads as one — the months of a range, say. */
export function concatRows(parts: RawLedgerRows[]): RawLedgerRows {
  return {
    expenses: parts.flatMap((p) => p.expenses),
    lines: parts.flatMap((p) => p.lines),
    unitCosts: parts.flatMap((p) => p.unitCosts),
  };
}

/**
 * The part of a ledger dated within a range — how a page takes its period,
 * and the one before it, back out of a single load.
 */
export function withinRange(ledger: Ledger, range: DateRange): Ledger {
  const expenses = ledger.expenses.filter((e) => expenseDate(e) >= range.start && expenseDate(e) <= range.end);
  const ids = new Set(expenses.map((e) => e.id));
  return {
    expenses,
    lines: ledger.lines.filter((l) => ids.has(l.expenseId)),
    unitCosts: ledger.unitCosts.filter((c) => ids.has(c.expense_id)),
  };
}

/** The smallest range covering all of these. */
export function spanOf(...ranges: DateRange[]): DateRange {
  return {
    start: ranges.map((r) => r.start).sort()[0],
    end: ranges.map((r) => r.end).sort().at(-1)!,
  };
}

/**
 * Each calendar month a range touches, as its first and last day. A ledger is
 * loaded and cached a month at a time, so any period is a handful of small
 * cache entries rather than one that can outgrow the cache (2 MB, beyond
 * which Next silently stops caching — and in development, throws).
 */
export function monthsCovering(range: DateRange): { key: string; start: string; end: string }[] {
  const out: { key: string; start: string; end: string }[] = [];
  let [y, m] = range.start.slice(0, 7).split("-").map(Number);
  const [endY, endM] = range.end.slice(0, 7).split("-").map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({ key, start: `${key}-01`, end: `${key}-${String(last).padStart(2, "0")}` });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

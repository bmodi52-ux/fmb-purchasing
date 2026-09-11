import { unstable_cache, updateTag } from "next/cache";
import { NOT_SPEND_FILTER } from "@/lib/expense-status";
import { createAdminClient } from "@/lib/supabase/admin";
import { categoryLabelsById } from "@/lib/categories";
import { allRows } from "@/lib/supabase/all-rows";
import { expenseDateFilter } from "@/lib/periods-data";
import { inPeriod } from "@/lib/periods";
import { expenseDate, type ExpenseRecord, type LineRecord } from "./aggregate";

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
};

export type ReportRawData = {
  allExpenses: ExpenseRecord[];
  allLines: LineRecord[];
  paidCosts: PaidCostRow[];
  /**
   * When these figures were actually read out of the database.
   *
   * Reported so the page can say how fresh it is. Every write through the
   * app revalidates this cache, so in normal use it is seconds old — but a
   * change made outside the app (a maintenance script, an edit in the
   * Supabase dashboard) does not, and the figures then stay wrong for up to
   * an hour with nothing on screen to suggest it. Money that is confidently
   * wrong is worse than money that is visibly old.
   */
  computedAt: string;
};

/** A range of calendar days, inclusive. */
export type DateRange = { start: string; end: string };

/**
 * Cache tag for everything derived from the expense ledger. Any action that
 * changes what a report would say revalidates it — see revalidateReports().
 */
export const REPORT_DATA_TAG = "report-data";

/**
 * Drops the cached report data. Call from a Server Action after any write that
 * changes the figures. `updateTag` rather than `revalidateTag` so the person
 * who just approved (or submitted, or withdrew) an expense sees their own
 * change on the next page rather than one stale render of the old numbers.
 */
export function revalidateReports(): void {
  updateTag(REPORT_DATA_TAG);
}

/**
 * A cheap fingerprint of the ledger for this range.
 *
 * How many expenses there are, and when one was last touched. Any change moves
 * one or the other: a submission or an edit moves the timestamp, a reset moves
 * the count.
 *
 * This is what makes the cache correct rather than merely fast. It is passed
 * as an argument to the cached function, so it forms part of the cache key —
 * when the ledger changes the key changes, and the next read is a miss. That
 * holds for changes made *outside* the app too, which nothing else here can
 * detect: a maintenance script, an edit in the Supabase dashboard, a restored
 * backup.
 */
async function ledgerFingerprint(range: DateRange): Promise<string> {
  const admin = createAdminClient();
  const { data, count } = await admin
    .from("expenses")
    .select("updated_at", { count: "exact" })
    .or(expenseDateFilter(range.start, range.end))
    .order("updated_at", { ascending: false })
    .limit(1);

  return `${count ?? 0}:${data?.[0]?.updated_at ?? "empty"}`;
}

/**
 * Expenses, lines and paid costs dated within a range, mapped into the shapes
 * aggregate.ts expects. Shared by Reports (which asks for the period on screen
 * and the one before it, in one fetch), the home dashboard (one fetch per
 * distinct period across its widgets) and Budgets.
 *
 * Ranges replaced fiscal years here in #22: a financial year or a quarter is a
 * range of days, and a Hijri year is simply one more range. Whatever is shown
 * is sliced back out with withinRange().
 *
 * Cached across requests: this reads the whole ledger for a period and
 * aggregates in JS, so it is by far the most expensive thing the home page and
 * Reports do, and the answer only changes when the data does. Every action
 * that can move a figure calls revalidateReports(), and the fingerprint
 * catches changes made outside the app. The one-hour revalidate is a backstop
 * for what the fingerprint cannot see — a category renamed, a vendor merged.
 */
export async function loadReportRawData(range: DateRange): Promise<ReportRawData> {
  const fingerprint = await ledgerFingerprint(range);
  return loadCachedReportRows(range.start, range.end, fingerprint);
}

/** The smallest range covering all of these. */
export function spanOf(...ranges: DateRange[]): DateRange {
  return {
    start: ranges.map((r) => r.start).sort()[0],
    end: ranges.map((r) => r.end).sort().at(-1)!,
  };
}

/**
 * Ids travel in the URL, so they go a slice at a time; and a response stops at
 * 1,000 rows without saying so, so each slice is paged. A year of line items
 * passes both limits easily — before this, a year with more than a thousand
 * lines was quietly reported short.
 */
const ID_CHUNK = 150;

async function rowsForExpenses<T>(
  expenseIds: string[],
  query: (ids: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < expenseIds.length; i += ID_CHUNK) chunks.push(expenseIds.slice(i, i + ID_CHUNK));
  const results = await Promise.all(chunks.map((ids) => allRows<T>((from, to) => query(ids, from, to))));
  return results.flat();
}

type RawExpense = {
  id: string;
  expense_number: string | null;
  vendor_id: string | null;
  vendor_name_raw: string | null;
  status: string;
  receipt_date: string | null;
  created_at: string;
  total: number;
  gst_amount: number;
};

type RawLine = {
  id: string;
  expense_id: string;
  category_id: string | null;
  line_total: number;
  line_gst: number | null;
  gst_applicable: boolean | null;
  quantity: number | null;
  description_raw: string;
  pricelist_items: unknown;
};

/** The cacheable half of the above. Returns only JSON-serializable values. */
const loadCachedReportRows = unstable_cache(
  // `fingerprint` is never read. It is here because arguments form part of the
  // cache key, so a changed ledger produces a different key and therefore a
  // miss — which is what makes this cache correct for writes that never pass
  // through a Server Action.
  async (start: string, end: string, fingerprint: string): Promise<ReportRawData> => {
    void fingerprint;
    const admin = createAdminClient();

    const [rawExpenses, { data: categoryRows }, { data: vendorRows }] = await Promise.all([
      allRows<RawExpense>((from, to) =>
        admin
          .from("expenses")
          .select("id, expense_number, vendor_id, vendor_name_raw, status, receipt_date, created_at, total, gst_amount")
          .or(expenseDateFilter(start, end))
          .not("status", "in", NOT_SPEND_FILTER)
          .order("id")
          .range(from, to)
      ),
      admin.from("categories").select("id, name, parent_category_id"),
      admin.from("vendors").select("id, name"),
    ]);

    const expenseIds = rawExpenses.map((e) => e.id);

    const [rawLines, paidCosts] = await Promise.all([
      // The item name is three tables up from a line — line → offer → pack
      // size → item — so it rides along as a nested embed rather than
      // costing another wave of queries.
      rowsForExpenses<RawLine>(expenseIds, (ids, from, to) =>
        admin
          .from("expense_line_items")
          .select(
            "id, expense_id, category_id, line_total, line_gst, gst_applicable, quantity, description_raw, pricelist_items ( item_pack_sizes ( items ( id, name ) ) )"
          )
          .in("expense_id", ids)
          .order("id")
          .range(from, to)
      ),
      rowsForExpenses<PaidCostRow>(expenseIds, (ids, from, to) =>
        admin
          .from("item_paid_unit_costs")
          .select(
            "item_id, item_name, expense_id, receipt_date, base_quantity, base_unit_code, cost_per_base_unit, line_total, normalized_quantity, sold_loose"
          )
          .in("expense_id", ids)
          .order("line_item_id")
          .range(from, to)
      ),
    ]);

    const categoryNameById = categoryLabelsById(categoryRows ?? []);
    const vendorNameById = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));

    const allExpenses: ExpenseRecord[] = rawExpenses.map((e) => ({
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

    const allLines: LineRecord[] = rawLines.map((l) => {
      const offer = l.pricelist_items as
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
        gst: Number(l.line_gst ?? 0),
        // Null only on lines written before 0026, when GST was shared out.
        gstApportioned: l.gst_applicable == null,
        quantity: l.quantity == null ? null : Number(l.quantity),
      };
    });

    return { allExpenses, allLines, paidCosts, computedAt: new Date().toISOString() };
  },
  ["report-raw-data"],
  { tags: [REPORT_DATA_TAG], revalidate: 3600 }
);

/**
 * The part of a loaded range that falls within a narrower one — how a page
 * takes its period, and the one before it, back out of a single fetch.
 */
export function withinRange(raw: ReportRawData, range: DateRange): ReportRawData {
  const expenses = raw.allExpenses.filter((e) => inPeriod(range, expenseDate(e)));
  const ids = new Set(expenses.map((e) => e.id));
  return {
    allExpenses: expenses,
    allLines: raw.allLines.filter((l) => ids.has(l.expenseId)),
    paidCosts: raw.paidCosts.filter((c) => ids.has(c.expense_id)),
    computedAt: raw.computedAt,
  };
}

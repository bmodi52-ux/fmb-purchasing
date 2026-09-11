import { unstable_cache, updateTag } from "next/cache";
import { NOT_SPEND_FILTER } from "@/lib/expense-status";
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
  line_total: number;
  /** Packs bought on the line. */
  normalized_quantity: number;
  sold_loose: boolean;
};

export type ReportRawData = {
  allExpenses: ExpenseRecord[];
  allLines: LineRecord[];
  paidCosts: PaidCostRow[];
  fyOf: Map<string, number>;
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

/** {@link ReportRawData} with `fyOf` flattened to entry pairs so it can be cached. */
type CachedReportRows = Omit<ReportRawData, "fyOf"> & { fyPairs: [string, number][] };

/**
 * Cache tag for everything derived from the expense ledger. Any action that
 * changes what a report would say revalidates it — see revalidateReports().
 */
export const REPORT_DATA_TAG = "report-data";

/**
 * Drops the cached report data. Call from a Server Action after any write that
 * changes the figures. `updateTag` rather than `revalidateTag` so the person
 * who just approved (or submitted, or deleted) an expense sees their own change
 * on the next page rather than one stale render of the old numbers.
 */
export function revalidateReports(): void {
  updateTag(REPORT_DATA_TAG);
}

/**
 * A cheap fingerprint of the ledger for these years.
 *
 * How many expenses there are, and when one was last touched. Any change moves
 * one or the other: a submission or an edit moves the timestamp, a deletion or
 * a reset moves the count.
 *
 * This is what makes the cache correct rather than merely fast. It is passed
 * as an argument to the cached function, so it forms part of the cache key —
 * when the ledger changes the key changes, and the next read is a miss. That
 * holds for changes made *outside* the app too, which nothing else here can
 * detect: a maintenance script, an edit in the Supabase dashboard, a restored
 * backup. Before this, those left the figures wrong for up to an hour.
 *
 * Two indexed columns and no join. In-region that is a few milliseconds
 * against the full-ledger read it decides whether to skip.
 */
async function ledgerFingerprint(years: number[]): Promise<string> {
  const admin = createAdminClient();
  const { data, count } = await admin
    .from("expenses")
    .select("updated_at", { count: "exact" })
    .in("fiscal_year_hijri", years)
    .order("updated_at", { ascending: false })
    .limit(1);

  return `${count ?? 0}:${data?.[0]?.updated_at ?? "empty"}`;
}

/**
 * Expenses/lines/paid-costs for a set of fiscal years, mapped into the
 * shapes aggregate.ts expects. Shared by the Reports page (which always asks
 * for the selected year plus the prior one, for the built-in comparison) and
 * the home dashboard (which asks for whichever distinct years its saved
 * widgets need — one fetch per distinct year, not one per widget).
 *
 * The result is cached across requests: this reads the whole ledger for a
 * year and aggregates in JS, so it is by far the most expensive thing the
 * home page and Reports do, and the answer only changes when the underlying
 * data does. Every action that can move a figure or rename something a report
 * displays calls revalidateReports(), so in-app edits show up immediately.
 *
 * Freshness comes from the fingerprint below rather than from the TTL: any
 * change to the ledger changes the cache key, including one made outside the
 * app entirely. The one-hour revalidate is a backstop for the case the
 * fingerprint cannot see — a category renamed, a vendor merged — and nothing
 * a person does waits on it.
 */
export async function loadReportRawData(fiscalYears: number[]): Promise<ReportRawData> {
  const years = [...new Set(fiscalYears)].sort((a, b) => a - b);
  const fingerprint = await ledgerFingerprint(years);
  const { allExpenses, allLines, paidCosts, fyPairs, computedAt } = await loadCachedReportRows(
    years,
    fingerprint
  );
  return { allExpenses, allLines, paidCosts, computedAt, fyOf: new Map(fyPairs) };
}

/**
 * The cacheable half of the above. Returns only JSON-serializable values —
 * `fyOf` is rebuilt as a Map by the caller, since the cache round-trips its
 * payload through serialization and a Map would not survive it.
 */
const loadCachedReportRows = unstable_cache(
  // `fingerprint` is never read. It is here because arguments form part of the
  // cache key, so a changed ledger produces a different key and therefore a
  // miss — which is what makes this cache correct for writes that never pass
  // through a Server Action.
  async (years: number[], fingerprint: string): Promise<CachedReportRows> => {
    void fingerprint;
    const admin = createAdminClient();

    const [{ data: rawExpenses }, { data: categoryRows }, { data: vendorRows }] = await Promise.all([
      admin
        .from("expenses")
        .select(
          "id, expense_number, vendor_id, vendor_name_raw, status, receipt_date, created_at, total, gst_amount, fiscal_year_hijri"
        )
        .in("fiscal_year_hijri", years)
        .not("status", "in", NOT_SPEND_FILTER),
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
              "expense_id, category_id, line_total, line_gst, gst_applicable, quantity, description_raw, pricelist_item_id, pricelist_items ( item_pack_sizes ( items ( id, name ) ) )"
            )
            .in("expense_id", expenseIds),
          admin
            .from("item_paid_unit_costs")
            .select(
              "item_id, item_name, expense_id, receipt_date, base_quantity, base_unit_code, cost_per_base_unit, line_total, normalized_quantity, sold_loose"
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

    const fyPairs: [string, number][] = (rawExpenses ?? []).map((e) => [
      e.id,
      e.fiscal_year_hijri,
    ]);

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
        gst: Number(l.line_gst ?? 0),
        // Null only on lines written before 0026, when GST was shared out.
        gstApportioned: l.gst_applicable == null,
        quantity: l.quantity == null ? null : Number(l.quantity),
      };
    });

    return {
      allExpenses,
      allLines,
      paidCosts: (paidCosts ?? []) as PaidCostRow[],
      fyPairs,
      computedAt: new Date().toISOString(),
    };
  },
  ["report-raw-data"],
  { tags: [REPORT_DATA_TAG], revalidate: 3600 }
);

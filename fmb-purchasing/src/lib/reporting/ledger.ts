import { unstable_cache, updateTag } from "next/cache";
import { NOT_SPEND_FILTER } from "@/lib/expense-status";
import { createAdminClient } from "@/lib/supabase/admin";
import { allRows, allRowsForIds } from "@/lib/supabase/all-rows";
import { LINE_OFFER } from "@/lib/supabase/relationships";
import {
  EXPENSE_COLUMNS,
  LINE_COLUMNS,
  UNIT_COST_COLUMNS,
  concatRows,
  flattenLineEmbed,
  monthsCovering,
  normaliseLedger,
  withinRange,
  type DateRange,
  type Dimensions,
  type EmbeddedLineRow,
  type Ledger,
  type PaidCostRow,
  type RawExpenseRow,
  type RawLedgerRows,
} from "./ledger-rows.ts";

/**
 * Loading the ledger (see ledger-rows.ts for what it is).
 *
 * Every report reads it through loadLedger: Reports, the home widgets,
 * Budgets, the approval budget notes, budget alerts and Accounting.
 *
 * Cached across requests, because a period's whole ledger is the most
 * expensive thing any page here reads, and it only changes when the data
 * does. Two things keep the cache honest:
 *
 *   - every action that can move a figure calls revalidateReports(), which
 *     drops every cached entry at once;
 *   - a fingerprint of the expenses table (how many, and when one was last
 *     touched) is part of every cache key, so a change made outside the app —
 *     a maintenance script, an edit in the Supabase dashboard, a restored
 *     backup — produces new keys and therefore fresh reads.
 *
 * The one-hour revalidate is a backstop for what neither can see: a category
 * renamed straight in the database, say.
 */

/**
 * Cache tag for everything derived from the expense ledger. Any action that
 * changes what a report would say revalidates it.
 */
export const REPORT_DATA_TAG = "report-data";

/**
 * Drops the cached ledger. Call from a Server Action after any write that
 * changes the figures. `updateTag` rather than `revalidateTag` so the person
 * who just approved (or submitted, or withdrew) an expense sees their own
 * change on the next page rather than one stale render of the old numbers.
 */
export function revalidateReports(): void {
  updateTag(REPORT_DATA_TAG);
}

/**
 * How many expenses there are, and when one was last touched — any change to
 * the ledger moves one or the other. Over the whole table rather than per
 * range: revalidateReports() drops every entry on any write anyway, so a
 * narrower fingerprint would keep nothing extra, and one query serves every
 * month of every page.
 */
async function ledgerFingerprint(): Promise<string> {
  const { data, count } = await createAdminClient()
    .from("expenses")
    .select("updated_at", { count: "exact" })
    .order("updated_at", { ascending: false })
    .limit(1);
  return `${count ?? 0}:${data?.[0]?.updated_at ?? "empty"}`;
}

/**
 * The ledger for a range, by the day each expense counts on (report_date).
 *
 * Loaded a calendar month at a time and cached per month, so a period is a
 * few small cache entries rather than one that outgrows the cache's 2 MB
 * limit — past which Next caches nothing and says so only in a log line.
 * Months are shared: Reports' two years, Budgets' one and a widget's quarter
 * all read the same entries.
 */
export async function loadLedger(range: DateRange): Promise<Ledger> {
  const fingerprint = await ledgerFingerprint();
  const [dims, ...months] = await Promise.all([
    loadDimensions(fingerprint),
    ...monthsCovering(range).map((m) => loadMonth(m.start, m.end, fingerprint)),
  ]);
  return withinRange(normaliseLedger(concatRows(months), dims), range);
}

/**
 * The ledger of expenses paid within a range, by payment date — Accounting's
 * cash basis. Uncached: it is read only there, and a payment date is not the
 * day a month's cache is keyed by.
 */
export async function loadLedgerByPaymentDate(range: DateRange): Promise<Ledger> {
  const admin = createAdminClient();
  const [expenses, dims] = await Promise.all([
    allRows<RawExpenseRow>((from, to) =>
      admin
        .from("expenses")
        .select(EXPENSE_COLUMNS)
        .eq("status", "paid")
        .gte("payment_date", range.start)
        .lte("payment_date", range.end)
        .order("id")
        .range(from, to)
    ),
    loadDimensions(await ledgerFingerprint()),
  ]);
  return normaliseLedger(await rowsFor(expenses), dims);
}

/** The lines and unit costs belonging to some expenses. */
async function rowsFor(expenses: RawExpenseRow[]): Promise<RawLedgerRows> {
  const admin = createAdminClient();
  const ids = expenses.map((e) => e.id);
  const [lines, unitCosts] = await Promise.all([
    allRowsForIds<EmbeddedLineRow>(ids, (slice, from, to) =>
      admin
        .from("expense_line_items")
        .select(`${LINE_COLUMNS}, pricelist_items!${LINE_OFFER} ( item_pack_sizes ( items ( id, name ) ) )`)
        .in("expense_id", slice)
        .order("id")
        .range(from, to)
    ),
    allRowsForIds<PaidCostRow>(ids, (slice, from, to) =>
      admin
        .from("item_paid_unit_costs")
        .select(UNIT_COST_COLUMNS)
        .in("expense_id", slice)
        .order("line_item_id")
        .range(from, to)
    ),
  ]);
  return { expenses, lines: lines.map(flattenLineEmbed), unitCosts };
}

/*
 * The cached halves. Arguments form part of an unstable_cache key, which is
 * why `fingerprint` is passed though never read: a changed ledger is a new
 * key, and so a miss. The version in each key names the shape of what is
 * cached — the cache outlives a deploy, so when the shape changes the version
 * must too, or new code reads entries written by the old.
 */

const loadMonth = unstable_cache(
  async (start: string, end: string, fingerprint: string): Promise<RawLedgerRows> => {
    void fingerprint;
    const expenses = await allRows<RawExpenseRow>((from, to) =>
      createAdminClient()
        .from("expenses")
        .select(EXPENSE_COLUMNS)
        .gte("report_date", start)
        .lte("report_date", end)
        .not("status", "in", NOT_SPEND_FILTER)
        .order("id")
        .range(from, to)
    );
    return rowsFor(expenses);
  },
  ["reporting-ledger-month", "v1"],
  { tags: [REPORT_DATA_TAG], revalidate: 3600 }
);

const loadDimensions = unstable_cache(
  async (fingerprint: string): Promise<Dimensions> => {
    void fingerprint;
    const admin = createAdminClient();
    const [{ data: categories }, vendors] = await Promise.all([
      admin.from("categories").select("id, name, parent_category_id, account_code"),
      allRows<{ id: string; name: string }>((from, to) =>
        admin.from("vendors").select("id, name").order("id").range(from, to)
      ),
    ]);
    return { categories: (categories ?? []) as Dimensions["categories"], vendors };
  },
  ["reporting-dimensions", "v1"],
  { tags: [REPORT_DATA_TAG], revalidate: 3600 }
);

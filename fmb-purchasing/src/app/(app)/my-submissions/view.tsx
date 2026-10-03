import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { expenseIdsWithAttachments } from "@/lib/receipt-storage";
import { ReportTile, ReportTiles } from "@/components/report-tile";
import { SubmissionsList } from "./submissions-list";

/**
 * How many of a person's own submissions to load.
 *
 * There was no limit and no year filter, unlike All expenses which caps at
 * 2,000 — so a prolific submitter fetched and shipped to the browser every
 * expense they had ever filed, on every visit, for ever. Filtering and sorting
 * both happen client-side here, so the row count is also the size of the
 * payload.
 *
 * 300 is roughly a year of heavy use. Anything older is reached through All
 * expenses, which has the fiscal-year picker this page does not need.
 */
const RECENT_LIMIT = 300;

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const expenses = (n: number) => `${n} ${n === 1 ? "expense" : "expenses"}`;

/**
 * A person's own submissions, for somebody already known to be allowed the
 * page: page.tsx does the signing in, as the report pages are split.
 */
export async function MySubmissionsView({ user }: { user: CurrentUser }) {
  const admin = createAdminClient();
  const { data, count } = await admin
    .from("expenses")
    .select(
      "id, expense_number, vendor_name_raw, invoice_number, total, status, submitter_comment, decision_comment, decided_at, payment_reference, payment_date, created_at",
      { count: "exact" }
    )
    .eq("submitted_by", user.id)
    .order("created_at", { ascending: false })
    .range(0, RECENT_LIMIT - 1);

  // One query for the whole page rather than one per row: the list only
  // needs to know whether to offer a link.
  const withFiles = await expenseIdsWithAttachments(admin, (data ?? []).map((e) => e.id));
  const rows = (data ?? []).map((e) => ({ ...e, hasReceipt: withFiles.has(e.id) }));

  // Where the money stands, before reading a single row: what is still with
  // the approvers, and what has been agreed but not yet paid back.
  const waiting = rows.filter((r) => r.status === "submitted");
  const unpaid = rows.filter((r) => r.status === "approved");
  const sum = (list: typeof rows) => list.reduce((total, r) => total + Number(r.total), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="page-title">My submissions</h1>
          <p className="page-description mt-1">Track the status of expenses you&apos;ve submitted.</p>
        </div>
        <Link href="/submit" className="btn btn-primary control self-start">
          + Submit another expense
        </Link>
      </div>

      {/* The same tile a report's headline figure sits in, so a figure is one
          size on every page — and only for a figure that is something: on a
          phone "$0.00, 0 expenses" was a tile's height saying nothing. */}
      {(waiting.length > 0 || unpaid.length > 0) && (
        <div className="max-w-2xl">
          <ReportTiles count={2}>
            {waiting.length > 0 && (
              <ReportTile label="Waiting for approval" value={money(sum(waiting))} hint={expenses(waiting.length)} />
            )}
            {unpaid.length > 0 && (
              <ReportTile label="Approved, not yet paid" value={money(sum(unpaid))} hint={expenses(unpaid.length)} />
            )}
          </ReportTiles>
        </div>
      )}

      {(count ?? 0) > rows.length && (
        <p className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-body text-ink">
          Showing your {rows.length} most recent of {count?.toLocaleString()} submissions. Older ones
          are on All expenses.
        </p>
      )}

      <SubmissionsList expenses={rows} />
    </div>
  );
}

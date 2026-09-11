import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { expenseIdsWithAttachments } from "@/lib/receipt-storage";
import { SubmissionsList } from "./submissions-list";

export const metadata = { title: "My submissions" };

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

export default async function MySubmissionsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "my_submissions", "view");

  const admin = createAdminClient();
  const { data: expenses, count } = await admin
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
  const withFiles = await expenseIdsWithAttachments(admin, (expenses ?? []).map((e) => e.id));
  const rows = (expenses ?? []).map((e) => ({ ...e, hasReceipt: withFiles.has(e.id) }));

  // Where the money stands, before reading a single row: what is still with
  // the approvers, and what has been agreed but not yet paid back.
  const waiting = rows.filter((r) => r.status === "submitted");
  const unpaid = rows.filter((r) => r.status === "approved");
  const sum = (list: typeof rows) => list.reduce((total, r) => total + Number(r.total), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="page-title text-ink">My submissions</h1>
          <p className="page-description mt-1">Track the status of expenses you&apos;ve submitted.</p>
        </div>
        <Link
          href="/submit"
          className="self-start whitespace-nowrap rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-gold-deep"
        >
          + Submit another expense
        </Link>
      </div>

      {(waiting.length > 0 || unpaid.length > 0) && (
        <dl className="grid grid-cols-2 gap-3 sm:max-w-lg">
          <div className="rounded-lg border border-ink/10 bg-white/60 p-3">
            <dt className="text-xs text-ink/55">Waiting for approval</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold text-ink">{money(sum(waiting))}</dd>
            <dd className="text-xs text-ink/45">
              {waiting.length} {waiting.length === 1 ? "expense" : "expenses"}
            </dd>
          </div>
          <div className="rounded-lg border border-ink/10 bg-white/60 p-3">
            <dt className="text-xs text-ink/55">Approved, not yet paid</dt>
            <dd className="mt-0.5 font-mono text-lg font-semibold text-ink">{money(sum(unpaid))}</dd>
            <dd className="text-xs text-ink/45">
              {unpaid.length} {unpaid.length === 1 ? "expense" : "expenses"}
            </dd>
          </div>
        </dl>
      )}

      {(count ?? 0) > rows.length && (
        <p className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-ink/80">
          Showing your {rows.length} most recent of {count?.toLocaleString()} submissions. Older ones
          are on All expenses.
        </p>
      )}

      <SubmissionsList expenses={rows} />
    </div>
  );
}

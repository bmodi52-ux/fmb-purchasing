import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { expenseIdsWithAttachments } from "@/lib/receipt-storage";
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">My submissions</h1>
        <p className="page-description mt-1">Track the status of expenses you&apos;ve submitted.</p>
      </div>

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

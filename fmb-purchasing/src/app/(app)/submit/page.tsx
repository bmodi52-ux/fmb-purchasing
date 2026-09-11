import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitForm } from "./submit-form";
import { getExpenseForEdit, getExpenseForResubmit } from "./actions";
import { leafCategories } from "@/lib/categories";
import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { formatDateTime } from "@/lib/format";
import type { StoredFile } from "@/lib/receipt-storage";
import { dismissInboundReceipt } from "./inbound-actions";

export const metadata = { title: "Submit expense" };

export default async function SubmitExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; resubmit?: string; inbound?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "submit_expense", "submit");

  const { edit, resubmit, inbound: inboundId } = await searchParams;
  const editExpense = edit ? await getExpenseForEdit(edit) : null;
  const resubmitFrom = !editExpense && resubmit ? await getExpenseForResubmit(resubmit) : null;

  const admin = createAdminClient();
  const [{ data: categories }, { data: vendors }] = await Promise.all([
    admin
      .from("categories")
      .select("id, name, parent_category_id, applies_to")
      .order("name"),
    admin.from("vendors").select("id, name").eq("status", "approved").order("name"),
  ]);

  // Receipts this person emailed in (#49): the one chosen, read as the page
  // opens, or the list of those still waiting.
  const newSubmission = !editExpense && !resubmitFrom;
  const { data: waiting } = newSubmission
    ? await admin
        .from("inbound_receipts")
        .select("id, subject, from_email, received_at, storage_path, file_name, size_bytes, sha256, attachment_count")
        .eq("user_id", user.id)
        .eq("status", "waiting")
        .order("received_at", { ascending: false })
        .limit(20)
    : { data: [] };
  const chosen = inboundId ? (waiting ?? []).find((r) => r.id === inboundId) : undefined;
  const inbound: StoredFile | null = chosen
    ? {
        storagePath: chosen.storage_path as string,
        fileName: chosen.file_name as string,
        contentType: "message/rfc822",
        sizeBytes: Number(chosen.size_bytes),
        sha256: chosen.sha256 as string,
        alreadyStored: true,
      }
    : null;
  const others = (waiting ?? []).filter((r) => r.id !== chosen?.id);
  const forwardingAddress = process.env.INBOUND_EMAIL_ADDRESS?.trim() || null;

  // Sorted by the name shown rather than by hierarchy: this picker lists bare
  // leaf names, so grouping Beef and Chicken at their parent's place in the
  // alphabet would read as no order at all. Each carries the line kinds it is
  // usually filed under, which decides the order they are offered in.
  const categoryOptions = leafCategories(categories ?? [])
    .map((c) => ({ name: c.name, appliesTo: c.applies_to ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">
          {editExpense ? "Edit expense" : resubmitFrom ? "Resubmit expense" : "Submit expense"}
        </h1>
        <p className="page-description mt-1 max-w-xl">
          {editExpense
            ? "You can edit this until it's approved or declined."
            : resubmitFrom
              ? `A copy of ${resubmitFrom.sourceNumber ?? "your earlier expense"}. Fix what's needed and submit — the original stays on record.`
              : "Upload a receipt for AI extraction, or enter the details manually. A receipt is never required."}
        </p>
      </div>
      {newSubmission && !inbound && others.length > 0 && (
        <section className="flex flex-col gap-2 rounded-lg border border-gold/40 bg-gold/5 p-4">
          <h2 className="section-title text-ink">
            {others.length === 1 ? "A receipt you emailed in" : `${others.length} receipts you emailed in`}
          </h2>
          <ul className="flex flex-col divide-y divide-ink/5 text-sm">
            {others.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="break-words text-ink">{(r.subject as string | null) || "No subject"}</p>
                  <p className="text-xs text-ink/55">
                    {formatDateTime(r.received_at as string)}
                    {Number(r.attachment_count) > 0 &&
                      ` · ${r.attachment_count} ${Number(r.attachment_count) === 1 ? "attachment" : "attachments"}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    href={`/submit?inbound=${r.id}`}
                    className="rounded-md bg-gold px-3.5 py-1.5 text-sm font-medium text-ink hover:bg-gold-deep"
                  >
                    Read and submit
                  </Link>
                  <form action={dismissInboundReceipt}>
                    <input type="hidden" name="inbound_id" value={r.id as string} />
                    <SubmitButton className="text-xs text-ink/55 underline hover:text-ink">Dismiss</SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {newSubmission && !inbound && forwardingAddress && (
        <p className="-mt-3 text-xs text-ink/55">
          You can also forward a receipt email to <span className="font-mono text-ink/75">{forwardingAddress}</span> from
          your own address — it will wait here for you.
        </p>
      )}
      <SubmitForm
        key={inbound?.sha256 ?? "new"}
        inbound={inbound}
        categories={categoryOptions}
        vendorNames={(vendors ?? []).map((v) => v.name)}
        myName={user.fullName || user.email}
        editExpense={editExpense}
        resubmitFrom={resubmitFrom}
      />
    </div>
  );
}

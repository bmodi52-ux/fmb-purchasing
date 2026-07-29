import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getUserPermissions, can } from "@/lib/permissions";
import { canViewExpense } from "@/lib/expense-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatDateTime } from "@/lib/format";
import { ReceiptViewer } from "@/components/receipt-viewer";

const money = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/** How a status reads as the expense's *current* state. */
const STATUS_LABEL: Record<string, string> = {
  submitted: "Awaiting review",
  approved: "Approved",
  declined: "Declined",
  paid: "Paid",
};

/**
 * How the same status reads as a *thing that happened*, in the history.
 * "Awaiting review" describes a state, not an event — the entry that put it
 * there was someone submitting it.
 */
const EVENT_LABEL: Record<string, string> = {
  submitted: "Submitted",
  approved: "Approved",
  declined: "Declined",
  paid: "Paid",
};

const STATUS_CLASS: Record<string, string> = {
  submitted: "bg-gold/20 text-gold-deep",
  approved: "bg-palm/15 text-palm",
  declined: "bg-maroon/10 text-maroon",
  paid: "bg-palm/20 text-palm",
};

/**
 * The whole life of one expense in a single view.
 *
 * Entry numbers exist so a submission can be followed from receipt to
 * payment, but until now that trail was spread across four list pages and
 * never assembled anywhere. This is the page the entry number points at.
 */
export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: expense } = await admin
    .from("expenses")
    .select(
      "id, expense_number, submitted_by, vendor_id, vendor_name_raw, invoice_number, receipt_date, receipt_file_path, subtotal, gst_amount, total, status, fiscal_year_hijri, decision_comment, decided_by, decided_at, payment_reference, payment_date, paid_by, created_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!expense) notFound();

  // Deliberately a redirect rather than a 404: someone following a link from
  // a notification they no longer have rights to should land somewhere
  // useful, not be told the expense doesn't exist.
  if (!(await canViewExpense(user, expense.submitted_by))) redirect("/");

  const permissions = await getUserPermissions(user.teamIds);

  const [{ data: lineItems }, { data: history }, { data: vendor }] = await Promise.all([
    admin
      .from("expense_line_items")
      .select(
        "id, description_raw, category_id, pricelist_item_id, quantity, unit_price, line_subtotal, line_gst, line_total, normalized_quantity, normalized_unit, sort_order"
      )
      .eq("expense_id", id)
      .order("sort_order"),
    admin
      .from("expense_status_history")
      .select("id, from_status, to_status, actor_id, comment, created_at")
      .eq("expense_id", id)
      .order("created_at"),
    expense.vendor_id
      ? admin
          .from("vendors")
          .select("id, name, vendor_number")
          .eq("id", expense.vendor_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // One round trip each for the names and labels the page needs, rather than
  // a join per row.
  const personIds = [
    ...new Set(
      [
        expense.submitted_by,
        expense.decided_by,
        expense.paid_by,
        ...(history ?? []).map((h) => h.actor_id),
      ].filter(Boolean) as string[]
    ),
  ];
  const categoryIds = [
    ...new Set((lineItems ?? []).map((l) => l.category_id).filter(Boolean) as string[]),
  ];
  const pricelistItemIds = [
    ...new Set((lineItems ?? []).map((l) => l.pricelist_item_id).filter(Boolean) as string[]),
  ];

  const [{ data: people }, { data: categories }, { data: offers }] = await Promise.all([
    personIds.length
      ? admin.from("profiles").select("id, full_name, email").in("id", personIds)
      : Promise.resolve({ data: [] }),
    categoryIds.length
      ? admin.from("categories").select("id, name").in("id", categoryIds)
      : Promise.resolve({ data: [] }),
    // A line item points at a vendor *offer*; the item it belongs to is a
    // level further up, through the pack size.
    pricelistItemIds.length
      ? admin
          .from("pricelist_items")
          .select("id, item_pack_sizes ( items ( id, name ) )")
          .in("id", pricelistItemIds)
      : Promise.resolve({ data: [] }),
  ]);

  const nameById = new Map(
    (people ?? []).map((p) => [p.id, p.full_name || p.email] as const)
  );
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c.name] as const));
  const itemByOfferId = new Map(
    (offers ?? []).map((o) => {
      const packSize = o.item_pack_sizes as unknown as {
        items: { id: string; name: string } | null;
      } | null;
      return [o.id, packSize?.items ?? null] as const;
    })
  );

  const person = (personId: string | null) =>
    personId ? nameById.get(personId) ?? "Unknown" : "—";

  const backHref = can(permissions, "all_expenses", "view") ? "/expenses" : "/my-submissions";
  const backLabel = backHref === "/expenses" ? "All expenses" : "My submissions";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href={backHref} className="text-sm text-ink/60 underline hover:text-ink">
          ← {backLabel}
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="page-title text-ink">{expense.expense_number ?? "Expense"}</h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              STATUS_CLASS[expense.status] ?? "bg-ink/10 text-ink/70"
            }`}
          >
            {STATUS_LABEL[expense.status] ?? expense.status}
          </span>
        </div>

        <p className="page-description mt-1">
          {vendor?.name ?? expense.vendor_name_raw ?? "Vendor not recorded"}
          {expense.receipt_date ? ` · ${formatDate(expense.receipt_date)}` : ""}
        </p>
      </div>

      {/* ---------------- summary ---------------- */}
      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Vendor">
            {vendor ? (
              <Link href={`/vendors/${vendor.id}`} className="underline">
                {vendor.name}
              </Link>
            ) : (
              expense.vendor_name_raw ?? "—"
            )}
          </Field>
          <Field label="Invoice number">{expense.invoice_number || "—"}</Field>
          <Field label="Receipt date">
            {expense.receipt_date ? formatDate(expense.receipt_date) : "—"}
          </Field>
          <Field label="Submitted by">{person(expense.submitted_by)}</Field>
          <Field label="Submitted at">{formatDateTime(expense.created_at)}</Field>
          <Field label="Fiscal year (Hijri)">{expense.fiscal_year_hijri}</Field>
        </dl>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-ink/10 pt-4">
          <dl className="flex flex-wrap gap-x-8 gap-y-2">
            <Field label="Subtotal">{money(expense.subtotal)}</Field>
            <Field label="GST">{money(expense.gst_amount)}</Field>
            <Field label="Total">
              <span className="text-base font-semibold">{money(expense.total)}</span>
            </Field>
          </dl>

          {expense.receipt_file_path && (
            <ReceiptViewer expenseId={expense.id} label="View receipt" />
          )}
        </div>
      </section>

      {/* ---------------- line items ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="section-title text-ink">Line items</h2>

        {(lineItems ?? []).length === 0 ? (
          <p className="text-sm text-ink/50">No line items recorded.</p>
        ) : (
          <>
            {/* Narrow screens: one card per line. A six-column table here
                pushes the amounts off the side, which are the numbers most
                worth reading on a page about one receipt. */}
            <ul className="flex flex-col gap-3 md:hidden">
              {(lineItems ?? []).map((line) => {
                const item = line.pricelist_item_id
                  ? itemByOfferId.get(line.pricelist_item_id)
                  : null;
                return (
                  <li
                    key={line.id}
                    className="rounded-lg border border-ink/10 bg-white/60 p-4 text-sm"
                  >
                    <p className="font-medium text-ink">{line.description_raw}</p>
                    {line.normalized_quantity && line.normalized_unit && (
                      <p className="text-xs text-ink/50">
                        {line.normalized_quantity} {line.normalized_unit}
                      </p>
                    )}
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                      <Field label="Category">
                        {line.category_id ? categoryById.get(line.category_id) ?? "—" : "—"}
                      </Field>
                      <Field label="Pricelist item">
                        {item ? (
                          <Link href={`/pricelist/${item.id}`} className="underline">
                            {item.name}
                          </Link>
                        ) : (
                          <span className="text-ink/40">Unmatched</span>
                        )}
                      </Field>
                      <Field label="Quantity">{line.quantity ?? "—"}</Field>
                      <Field label="Unit price">
                        {line.unit_price != null ? money(line.unit_price) : "—"}
                      </Field>
                    </dl>
                    <p className="mt-3 border-t border-ink/10 pt-2 text-right font-semibold text-ink">
                      {money(line.line_total)}
                    </p>
                  </li>
                );
              })}
            </ul>

            <div className="hidden overflow-x-auto rounded-lg border border-ink/10 bg-white/60 md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-ink/10 text-left text-ink/60">
                <tr>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Pricelist item</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Unit price</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {(lineItems ?? []).map((line) => {
                  const item = line.pricelist_item_id
                    ? itemByOfferId.get(line.pricelist_item_id)
                    : null;
                  return (
                    <tr key={line.id} className="border-b border-ink/5 last:border-0">
                      <td className="px-4 py-2">
                        {line.description_raw}
                        {line.normalized_quantity && line.normalized_unit && (
                          <span className="block text-xs text-ink/50">
                            {line.normalized_quantity} {line.normalized_unit}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-ink/70">
                        {line.category_id ? categoryById.get(line.category_id) ?? "—" : "—"}
                      </td>
                      <td className="px-4 py-2">
                        {item ? (
                          <Link href={`/pricelist/${item.id}`} className="underline">
                            {item.name}
                          </Link>
                        ) : (
                          <span className="text-ink/40">Unmatched</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {line.quantity ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {line.unit_price != null ? money(line.unit_price) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {money(line.line_total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </section>

      {/* ---------------- payment ---------------- */}
      {expense.status === "paid" && (
        <section className="flex flex-col gap-3">
          <h2 className="section-title text-ink">Payment</h2>
          <dl className="grid gap-x-8 gap-y-4 rounded-lg border border-ink/10 bg-white/60 p-5 sm:grid-cols-3">
            <Field label="Reference">{expense.payment_reference || "—"}</Field>
            <Field label="Paid on">
              {expense.payment_date ? formatDate(expense.payment_date) : "—"}
            </Field>
            <Field label="Marked paid by">{person(expense.paid_by)}</Field>
          </dl>
        </section>
      )}

      {/* ---------------- timeline ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="section-title text-ink">History</h2>

        {(history ?? []).length === 0 ? (
          <p className="text-sm text-ink/50">Nothing recorded yet.</p>
        ) : (
          <ol className="flex flex-col gap-0">
            {(history ?? []).map((event, i) => (
              <li key={event.id} className="flex gap-3">
                {/* Rail: a dot per event, joined by a line except after the last */}
                <div className="flex flex-col items-center">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" />
                  {i < (history ?? []).length - 1 && (
                    <span className="w-px flex-1 bg-ink/15" aria-hidden="true" />
                  )}
                </div>
                <div className="pb-5">
                  <p className="text-sm text-ink">
                    <span className="font-medium">
                      {EVENT_LABEL[event.to_status] ?? event.to_status}
                    </span>
                    {" · "}
                    <span className="text-ink/70">{person(event.actor_id)}</span>
                  </p>
                  <p className="text-xs text-ink/50">{formatDateTime(event.created_at)}</p>
                  {event.comment && (
                    <p className="mt-1 text-sm text-ink/80">{event.comment}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink/55">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

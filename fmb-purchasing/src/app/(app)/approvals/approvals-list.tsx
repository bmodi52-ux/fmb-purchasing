"use client";

import Link from "next/link";
import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Dialog } from "@/components/dialog";
import { ReceiptInline } from "@/components/receipt-inline";
import { reviewExpense, bulkReviewExpenses } from "./actions";
import { formatDate, formatPlainDate } from "@/lib/format";
import { FilterableSection, type BulkAction, type SortOption } from "@/components/filterable-section";
import type { ExportColumn } from "@/lib/export";
import { duplicateLabel, type DuplicateMatch } from "@/lib/duplicates";

export type ApprovalLineItem = {
  description_raw: string;
  categoryName: string;
  quantity: number | null;
  unit_price: number | null;
  line_total: number;
};

/** What is worth a second look before approving. */
export type ApprovalFlags = {
  /** The vendor was added by this submission and nobody has reviewed it. */
  newVendor: boolean;
  /** The payee's bank account is one nobody who pays has confirmed. */
  unconfirmedAccount: boolean;
  /** Lines filed against Pricelist items this receipt created. */
  newItems: number;
  /** Other expenses with the same file, or the same vendor and invoice number. */
  duplicateOf: DuplicateMatch[];
};

export type ApprovalRow = {
  id: string;
  expense_number: string | null;
  vendor_name_raw: string | null;
  invoice_number: string | null;
  receipt_date: string | null;
  subtotal: number;
  gst_amount: number;
  total: number;
  submittedByName: string;
  created_at: string;
  hasReceipt: boolean;
  submitterComment: string | null;
  flags: ApprovalFlags;
  lineItems: ApprovalLineItem[];
};

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "expense_number", label: "Entry #" },
  { key: "vendor_name_raw", label: "Vendor" },
  { key: "submittedByName", label: "Submitted by" },
  { key: "invoice_number", label: "Invoice #" },
  { key: "receipt_date", label: "Receipt date" },
  { key: "subtotal", label: "Subtotal" },
  { key: "gst_amount", label: "GST" },
  { key: "total", label: "Total" },
  { key: "created_at", label: "Submitted at" },
];

const SORT_OPTIONS: SortOption<ApprovalRow>[] = [
  { key: "created_at", label: "Submitted", value: (e) => e.created_at },
  { key: "receipt_date", label: "Receipt date", value: (e) => e.receipt_date ?? "" },
  { key: "total", label: "Total", value: (e) => e.total },
  { key: "vendor", label: "Vendor", value: (e) => e.vendor_name_raw ?? "" },
  { key: "submitter", label: "Submitted by", value: (e) => e.submittedByName },
];

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/**
 * The Approvals queue.
 *
 * Every expense used to be a collapsed row showing its number, vendor,
 * submitter and date — so the amount, the lines, the receipt and the decision
 * were each a click away, for every row in turn. Now a row carries what is
 * needed to decide, with Approve and Decline on it, and "Review one by one"
 * walks the queue with the receipt beside its lines.
 */
export function ApprovalsList({ expenses, showSubmitter }: { expenses: ApprovalRow[]; showSubmitter: boolean }) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (expenses.length === 0) {
    return <p className="text-sm text-ink/50">Nothing waiting for review.</p>;
  }

  const bulkActions: BulkAction<ApprovalRow>[] = [
    {
      label: "Approve selected",
      onClick: (selected) => bulkReviewExpenses(selected.map((e) => e.id), "approved"),
    },
    {
      label: "Decline selected",
      variant: "danger",
      onClick: (selected) => bulkReviewExpenses(selected.map((e) => e.id), "declined"),
    },
  ];

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <FilterableSection
        rows={expenses}
        searchText={(e) => `${e.vendor_name_raw ?? ""} ${e.submittedByName} ${e.invoice_number ?? ""} ${e.expense_number ?? ""}`}
        columns={EXPORT_COLUMNS}
        filenameBase="approvals"
        title="Approvals"
        placeholder="Filter by vendor, submitter, invoice…"
        bulkActions={bulkActions}
        sortOptions={SORT_OPTIONS}
      >
        {(rows, selection) => (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={() => rows[0] && setReviewingId(rows[0].id)}
                disabled={rows.length === 0}
                className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-deep disabled:opacity-50"
              >
                Review one by one
              </button>
              <span className="text-xs text-ink/50">The receipt beside its lines; the next opens after each decision.</span>
            </div>

            {rows.map((e) => (
              <div key={e.id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selection.isSelected(e.id)}
                  onChange={() => selection.toggle(e.id)}
                  aria-label={`Select ${e.expense_number ?? "expense"}`}
                  className="mt-5"
                />
                <div className="min-w-0 flex-1 rounded-lg border border-ink/10 bg-white/60 p-4">
                  <ExpenseSummary expense={e} showSubmitter={showSubmitter} />

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <DecisionButtons key={e.id} expenseId={e.id} />
                    <button
                      type="button"
                      onClick={() => setReviewingId(e.id)}
                      className="rounded-md border border-ink/15 px-3 py-2 text-sm text-ink/70 hover:border-ink/30"
                    >
                      Review
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(e.id)}
                      aria-expanded={expanded.has(e.id)}
                      className="ml-auto px-2 py-2 text-sm text-ink/60 underline hover:text-ink"
                    >
                      {expanded.has(e.id) ? "Hide details" : "Details"}
                    </button>
                  </div>

                  {expanded.has(e.id) && (
                    <div className="mt-4 border-t border-ink/10 pt-4">
                      <ExpenseDetails expense={e} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </FilterableSection>

      {reviewingId && (
        <ReviewSession
          rows={expenses}
          startId={reviewingId}
          showSubmitter={showSubmitter}
          onClose={() => setReviewingId(null)}
        />
      )}
    </>
  );
}

/** Vendor, amount, the facts that matter, and anything worth a second look. */
function ExpenseSummary({ expense: e, showSubmitter }: { expense: ApprovalRow; showSubmitter: boolean }) {
  const facts = [
    e.receipt_date ? formatPlainDate(e.receipt_date) : "No receipt date",
    `${e.lineItems.length} ${e.lineItems.length === 1 ? "line" : "lines"}`,
    e.hasReceipt ? "receipt attached" : "no receipt",
    showSubmitter ? e.submittedByName : null,
  ].filter(Boolean);

  const flags: { label: string; serious?: boolean }[] = [];
  if (e.flags.duplicateOf.length > 0) flags.push({ label: duplicateLabel(e.flags.duplicateOf), serious: true });
  if (e.flags.unconfirmedAccount) flags.push({ label: "Bank account not confirmed", serious: true });
  if (e.flags.newVendor) flags.push({ label: "New vendor" });
  if (e.flags.newItems > 0) {
    flags.push({ label: `${e.flags.newItems} new Pricelist ${e.flags.newItems === 1 ? "item" : "items"}` });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium break-words text-ink">{e.vendor_name_raw ?? "Vendor not recorded"}</span>
            <Link href={`/expenses/${e.id}`} className="font-mono text-xs text-ink/60 underline">
              {e.expense_number ?? "View"}
            </Link>
          </p>
          <p className="mt-0.5 text-sm text-ink/55">{facts.join(" · ")}</p>
        </div>
        <span className="font-mono text-lg font-semibold text-ink">{money(e.total)}</span>
      </div>

      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <span
              key={f.label}
              className={`rounded-full px-2 py-0.5 text-xs ${
                f.serious ? "bg-maroon/10 text-maroon" : "bg-gold/15 text-gold-deep"
              }`}
            >
              {f.label}
            </span>
          ))}
        </div>
      )}

      {/* The submitter wrote this for whoever decides, so it is not hidden. */}
      {e.submitterComment && (
        <p className="rounded-md border border-gold/40 bg-gold/5 px-3 py-1.5 text-sm">
          <span className="text-ink/50">Note from {e.submittedByName}: </span>
          <span className="whitespace-pre-wrap text-ink">{e.submitterComment}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Approve in one tap; Decline asks why first, because the reason is what the
 * submitter reads and a bare "declined" leaves them nothing to fix.
 */
function DecisionButtons({ expenseId, approveLabel = "Approve" }: { expenseId: string; approveLabel?: string }) {
  const [declining, setDeclining] = useState(false);

  if (declining) {
    return (
      <form action={reviewExpense} className="flex w-full flex-wrap items-end gap-2">
        <input type="hidden" name="expense_id" value={expenseId} />
        <input type="hidden" name="decision" value="declined" />
        <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm">
          <span className="text-ink/70">Reason for declining</span>
          <input name="comment" required placeholder="Sent to whoever submitted it" className="input" />
        </label>
        <SubmitButton className="rounded-md border border-maroon/40 bg-white px-4 py-2 text-sm font-medium text-maroon hover:bg-maroon/5">
          Decline
        </SubmitButton>
        <button
          type="button"
          onClick={() => setDeclining(false)}
          className="px-2 py-2 text-sm text-ink/60 underline hover:text-ink"
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <>
      <form action={reviewExpense}>
        <input type="hidden" name="expense_id" value={expenseId} />
        <input type="hidden" name="decision" value="approved" />
        <SubmitButton className="rounded-md bg-palm/90 px-4 py-2 text-sm font-medium text-white hover:bg-palm">
          {approveLabel}
        </SubmitButton>
      </form>
      <button
        type="button"
        onClick={() => setDeclining(true)}
        className="rounded-md border border-maroon/40 px-4 py-2 text-sm font-medium text-maroon hover:bg-maroon/5"
      >
        Decline
      </button>
    </>
  );
}

function LineItemsTable({ lines }: { lines: ApprovalLineItem[] }) {
  if (lines.length === 0) return <p className="text-sm text-ink/50">No line items recorded.</p>;
  return (
    // Scrolls on its own: five columns don't fit a phone, and the app shell
    // clips anything that runs past the screen.
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink/50">
            <th scope="col" className="p-1">Description</th>
            <th scope="col" className="p-1">Category</th>
            <th scope="col" className="p-1 text-right">Qty</th>
            <th scope="col" className="p-1 text-right">Unit price</th>
            <th scope="col" className="p-1 text-right">Line total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((li, i) => (
            <tr key={i} className="border-t border-ink/5">
              <td className="p-1">{li.description_raw}</td>
              <td className="p-1 text-ink/60">{li.categoryName}</td>
              <td className="p-1 text-right font-mono">{li.quantity ?? "—"}</td>
              <td className="p-1 text-right font-mono">{li.unit_price != null ? money(li.unit_price) : "—"}</td>
              <td className="p-1 text-right font-mono">{money(li.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ expense: e }: { expense: ApprovalRow }) {
  return (
    <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-ink/10 pt-2 font-mono text-sm text-ink/70">
      <span>Subtotal: {money(e.subtotal)}</span>
      <span>GST: {money(e.gst_amount)}</span>
      <span className="font-semibold text-ink">Total: {money(e.total)}</span>
    </div>
  );
}

/** The lines and totals, with the receipt drawn beside them rather than in a popup. */
function ExpenseDetails({ expense: e }: { expense: ApprovalRow }) {
  return (
    <div className={`grid grid-cols-1 gap-4 ${e.hasReceipt ? "lg:grid-cols-2" : ""}`}>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-ink/60">
          Invoice {e.invoice_number || "—"} · submitted {formatDate(e.created_at)} by {e.submittedByName}
        </p>
        <LineItemsTable lines={e.lineItems} />
        <Totals expense={e} />
      </div>
      {e.hasReceipt && <ReceiptInline key={e.id} expenseId={e.id} className="max-h-[70vh]" />}
    </div>
  );
}

/**
 * The queue, one expense at a time.
 *
 * A decision refreshes the page and the expense leaves the list; whatever now
 * sits in its position is the next one, so deciding is also moving on. Holds
 * a position rather than an index into a list that is changing under it.
 */
function ReviewSession({
  rows,
  startId,
  showSubmitter,
  onClose,
}: {
  rows: ApprovalRow[];
  startId: string;
  showSubmitter: boolean;
  onClose: () => void;
}) {
  const [currentId, setCurrentId] = useState(startId);
  const [position, setPosition] = useState(() => Math.max(0, rows.findIndex((r) => r.id === startId)));

  const found = rows.findIndex((r) => r.id === currentId);
  const index = found >= 0 ? found : Math.min(position, rows.length - 1);
  const current = index >= 0 ? rows[index] : null;

  function go(nextIndex: number) {
    const next = rows[nextIndex];
    if (!next) return;
    setCurrentId(next.id);
    setPosition(nextIndex);
  }

  return (
    <Dialog
      title={current ? `Reviewing ${index + 1} of ${rows.length}` : "All reviewed"}
      align="start"
      onClose={onClose}
      className="flex w-full max-w-6xl flex-col rounded-lg border border-ink/10 bg-cream p-4 shadow-lg sm:p-6"
    >
      {!current ? (
        <div className="flex flex-col items-start gap-3 py-4">
          <p className="text-sm text-ink/70">Nothing left waiting for review.</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-deep"
          >
            Back to Approvals
          </button>
        </div>
      ) : (
        <div key={current.id} className="flex flex-col gap-4">
          <ExpenseSummary expense={current} showSubmitter={showSubmitter} />

          <div className={`grid grid-cols-1 gap-4 ${current.hasReceipt ? "lg:grid-cols-2" : ""}`}>
            {current.hasReceipt && (
              <ReceiptInline expenseId={current.id} className="max-h-[55vh] lg:max-h-[70vh]" />
            )}
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-sm text-ink/60">
                Invoice {current.invoice_number || "—"} · submitted {formatDate(current.created_at)} by{" "}
                {current.submittedByName}
              </p>
              <LineItemsTable lines={current.lineItems} />
              <Totals expense={current} />
            </div>
          </div>

          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-ink/10 bg-cream px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6">
            <DecisionButtons
              expenseId={current.id}
              approveLabel={index < rows.length - 1 ? "Approve & next" : "Approve"}
            />
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => go(index - 1)}
                disabled={index === 0}
                className="rounded-md border border-ink/15 px-3 py-2 text-sm text-ink/70 hover:border-ink/30 disabled:opacity-40"
              >
                ← Previous
              </button>
              <button
                type="button"
                onClick={() => go(index + 1)}
                disabled={index >= rows.length - 1}
                className="rounded-md border border-ink/15 px-3 py-2 text-sm text-ink/70 hover:border-ink/30 disabled:opacity-40"
              >
                Skip →
              </button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Dialog } from "@/components/dialog";
import { ReceiptInline } from "@/components/receipt-inline";
import { reviewExpense, bulkReviewExpenses } from "./actions";
import { formatDate, formatPlainDate } from "@/lib/format";
import {
  FilterableSection,
  type BulkAction,
  type SelectionApi,
  type SortOption,
} from "@/components/filterable-section";
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
  /** What the ABR says is wrong with GST from this vendor, in words. */
  gstConcerns: string[];
  /** Lines whose price per unit moved past its limit or sits outside its expected range (#29). */
  prices: { label: string; serious: boolean }[];
  /** How far above the vendor's usual expense this one is, in words (#42). */
  unusualSpend: string | null;
  /** Money not on the receipt, a changed total, or an unexplained difference (#51). */
  receipt: { label: string; serious: boolean }[];
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
  /** Where this expense leaves each of its categories' budgets (#39). */
  budgetNotes: { text: string; over: boolean }[];
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
 * The columns of the queue once there is room for a table: the tick box, the
 * vendor, the receipt's date, its lines, whether it is attached, the total,
 * and the buttons. Named once so the headings and every row share one grid.
 */
const TABLE_COLUMNS = "@[62rem]:grid-cols-[1rem_minmax(0,1fr)_6.2rem_2.6rem_5rem_6.6rem_18.5rem]";

/**
 * The Approvals queue.
 *
 * Every expense used to be a collapsed row showing its number, vendor,
 * submitter and date — so the amount, the lines, the receipt and the decision
 * were each a click away, for every row in turn. Now a row carries what is
 * needed to decide, with Approve and Decline on it, and "Review one by one"
 * walks the queue with the receipt beside its lines.
 *
 * Each expense was then a card some ten lines tall, and a queue of 141 was a
 * scroll of forty phone screens. So the queue is drawn a page at a time, and
 * on a screen with the room for it an expense is one line of a table: 25 of
 * them in the height ten cards took. A narrower screen keeps a card each,
 * with the buttons beside the vendor until there is no room for that either.
 */
export function ApprovalsList({ expenses, showSubmitter }: { expenses: ApprovalRow[]; showSubmitter: boolean }) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  if (expenses.length === 0) {
    return <p className="text-body text-ink/70">Nothing waiting for review.</p>;
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
        amountOf={(e) => e.total}
        sortOptions={SORT_OPTIONS}
        pageKey="approvals"
        selectAllButton={false}
        actions={(filtered) => (
          <button
            type="button"
            onClick={() => filtered[0] && setReviewingId(filtered[0].id)}
            disabled={filtered.length === 0}
            title="The receipt beside its lines; the next opens after each decision"
            className="btn btn-primary control flex-1 sm:flex-none"
          >
            Review one by one
          </button>
        )}
      >
        {(rows, selection, pager) => (
          <Queue
            rows={rows}
            selection={selection}
            pager={pager}
            showSubmitter={showSubmitter}
            onReview={setReviewingId}
          />
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

/** One page of the queue: a table where it fits, a card each where it doesn't. */
function Queue({
  rows,
  selection,
  pager,
  showSubmitter,
  onReview,
}: {
  rows: ApprovalRow[];
  selection: SelectionApi;
  pager: React.ReactNode;
  showSubmitter: boolean;
  onReview: (id: string) => void;
}) {
  if (rows.length === 0) return <p className="text-body text-ink/70">Nothing matches the filters.</p>;

  // With a pager under it, "all" can only honestly mean the page in view.
  const selectAllLabel = pager ? "Select all on this page" : `Select all ${rows.length}`;

  return (
    // The list answers to its own width, not the window's: beside a sidebar
    // a laptop has less room than its screen size suggests.
    <div className="@container">
      <div className="flex flex-col gap-2.5 @[62rem]:gap-0 @[62rem]:rounded-[0.625rem] @[62rem]:border @[62rem]:border-ink/[0.09] @[62rem]:bg-white @[62rem]:shadow-[0_1px_2px_rgb(43_33_28/0.04)]">
        <div
          className={`hidden items-center gap-x-3.5 border-b border-ink/15 px-[1.2rem] py-2.5 text-support font-semibold text-ink/70 @[62rem]:grid ${TABLE_COLUMNS}`}
        >
          <input
            type="checkbox"
            checked={selection.allShownSelected}
            onChange={selection.toggleAllShown}
            aria-label={selectAllLabel}
            className="size-4"
          />
          <span>Vendor</span>
          <span>Receipt date</span>
          <span className="text-right">Lines</span>
          <span>Receipt</span>
          <span className="text-right">Total</span>
          <span />
        </div>

        {/* No headings to hold a tick box until there is a table. */}
        <label className="flex items-center gap-2.5 self-start px-0.5 text-support text-ink/70 @[62rem]:hidden">
          <input
            type="checkbox"
            checked={selection.allShownSelected}
            onChange={selection.toggleAllShown}
            className="size-4"
          />
          {selectAllLabel}
        </label>

        <ul className="flex flex-col gap-2.5 @[62rem]:gap-0">
          {rows.map((e) => (
            <QueueRow
              key={e.id}
              expense={e}
              showSubmitter={showSubmitter}
              selected={selection.isSelected(e.id)}
              onSelect={() => selection.toggle(e.id)}
              onReview={() => onReview(e.id)}
            />
          ))}
        </ul>

        {pager && <div className="@[62rem]:border-t @[62rem]:border-ink/10 @[62rem]:px-[1.2rem] @[62rem]:py-3">{pager}</div>}
      </div>
    </div>
  );
}

/**
 * One expense in the queue.
 *
 * The same elements in three arrangements, by how wide the list is: a line of
 * a table; a card with its buttons beside the vendor; and, on a phone, a card
 * with the buttons across the bottom at a finger's height.
 */
function QueueRow({
  expense: e,
  showSubmitter,
  selected,
  onSelect,
  onReview,
}: {
  expense: ApprovalRow;
  showSubmitter: boolean;
  selected: boolean;
  onSelect: () => void;
  onReview: () => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const number = e.expense_number ?? "View";
  const lines = e.lineItems.length;
  const flags = flagsOf(e);
  const hasExtras =
    flags.length > 0 || e.budgetNotes.length > 0 || Boolean(e.submitterComment) || declining || expanded;

  // What a table says in columns, a card says in a line under the vendor.
  const facts = [
    e.receipt_date ? formatPlainDate(e.receipt_date) : "No receipt date",
    `${lines} ${lines === 1 ? "line" : "lines"}`,
    e.hasReceipt ? "receipt attached" : "no receipt",
    showSubmitter ? e.submittedByName : null,
  ].filter(Boolean);

  // In the table a button is a row's height; in a card it is a control's.
  const rowButton = "control @[62rem]:h-8 @[62rem]:px-3 @[62rem]:text-support";

  return (
    <li className="card p-3.5 @[62rem]:rounded-none @[62rem]:border-0 @[62rem]:border-b @[62rem]:border-ink/[0.06] @[62rem]:bg-transparent @[62rem]:px-[1.2rem] @[62rem]:py-2.5 @[62rem]:shadow-none @[62rem]:last:border-b-0 @[62rem]:hover:bg-gold/[0.06]">
      <div className={`flex flex-wrap items-center gap-x-3.5 gap-y-2 @[62rem]:grid ${TABLE_COLUMNS}`}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`Select ${e.expense_number ?? "expense"}`}
          className="size-4 shrink-0"
        />

        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-2">
            {/* Cut short in the table when the name outruns its column; the whole of it on hover. */}
            <span
              title={e.vendor_name_raw ?? undefined}
              className="min-w-0 text-base font-semibold break-words text-ink @[62rem]:truncate @[62rem]:text-body"
            >
              {e.vendor_name_raw ?? "Vendor not recorded"}
            </span>
            <Link
              href={`/expenses/${e.id}`}
              className="hidden shrink-0 text-support font-medium tabular-nums text-brand underline-offset-2 hover:underline @[62rem]:inline"
            >
              {number}
            </Link>
          </p>
          {/* Who sent it only earns its place when there is more than one of them. */}
          {showSubmitter && (
            <p className="hidden truncate text-support text-ink/70 @[62rem]:block">{e.submittedByName}</p>
          )}
        </div>

        <span className="hidden text-body tabular-nums text-ink/70 @[62rem]:block">
          {e.receipt_date ? formatPlainDate(e.receipt_date) : "—"}
        </span>
        <span className="hidden text-right text-body tabular-nums text-ink/70 @[62rem]:block">{lines}</span>
        <span className="hidden text-body text-ink/70 @[62rem]:block">{e.hasReceipt ? "Attached" : "None"}</span>

        <span className="text-base font-semibold tabular-nums text-ink @[62rem]:text-right @[62rem]:text-body">
          {money(e.total)}
        </span>

        <div className="order-3 flex w-full items-center gap-2 @[46rem]:order-none @[46rem]:w-auto @[62rem]:justify-end">
          <form action={reviewExpense} className="flex-1 @[46rem]:flex-none">
            <input type="hidden" name="expense_id" value={e.id} />
            <input type="hidden" name="decision" value="approved" />
            <SubmitButton className={`btn btn-approve w-full ${rowButton}`}>Approve</SubmitButton>
          </form>
          <button
            type="button"
            onClick={() => setDeclining((d) => !d)}
            aria-expanded={declining}
            className={`btn btn-danger flex-1 @[46rem]:flex-none ${rowButton}`}
          >
            Decline
          </button>
          <button
            type="button"
            onClick={onReview}
            className={`btn btn-secondary flex-1 @[46rem]:flex-none ${rowButton}`}
          >
            Review
          </button>
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} the lines of ${e.expense_number ?? "this expense"}`}
            title={expanded ? "Hide details" : "Details"}
            className="btn btn-secondary control aspect-square shrink-0 px-0 text-ink/70 hover:text-ink @[62rem]:h-8 @[62rem]:border-transparent @[62rem]:bg-transparent"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            >
              <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <p className="order-1 w-full pl-[1.875rem] text-support text-ink/70 @[62rem]:hidden">
          <Link
            href={`/expenses/${e.id}`}
            className="font-medium tabular-nums text-brand underline-offset-2 hover:underline"
          >
            {number}
          </Link>{" "}
          · {facts.join(" · ")}
        </p>

        {hasExtras && (
          <div className="order-2 flex w-full flex-col gap-2 @[62rem]:col-span-full @[62rem]:pl-[1.875rem]">
            <Flags flags={flags} />
            <BudgetNotes notes={e.budgetNotes} />
            <SubmitterNote expense={e} />

            {/* Decline asks why first, because the reason is what the submitter
                reads and a bare "declined" leaves them nothing to fix. */}
            {declining && (
              <form action={reviewExpense} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="expense_id" value={e.id} />
                <input type="hidden" name="decision" value="declined" />
                <label className="flex min-w-0 flex-1 basis-64 flex-col gap-1 text-support text-ink/70">
                  Reason for declining
                  <input
                    name="comment"
                    required
                    placeholder="Sent to whoever submitted it"
                    className="input control text-body"
                  />
                </label>
                <SubmitButton className="btn btn-danger control">Decline</SubmitButton>
                <button type="button" onClick={() => setDeclining(false)} className="btn btn-quiet control">
                  Cancel
                </button>
              </form>
            )}

            {expanded && (
              <div className="border-t border-ink/10 pt-3">
                <ExpenseDetails expense={e} />
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

type Flag = { label: string; serious?: boolean; alert?: boolean };

/** Everything about an expense worth a second look, most serious kinds first. */
function flagsOf(e: ApprovalRow): Flag[] {
  const flags: Flag[] = [];
  if (e.flags.duplicateOf.length > 0) flags.push({ label: duplicateLabel(e.flags.duplicateOf), serious: true });
  for (const concern of e.flags.gstConcerns) flags.push({ label: concern, serious: true });
  // Alert red, brighter than danger: these are about the money itself (#63).
  for (const r of e.flags.receipt) flags.push({ ...r, alert: true });
  if (e.flags.unconfirmedAccount) flags.push({ label: "Bank account not confirmed", serious: true });
  if (e.flags.unusualSpend) flags.push({ label: e.flags.unusualSpend, serious: true });
  for (const price of e.flags.prices) flags.push(price);
  if (e.flags.newVendor) flags.push({ label: "New vendor" });
  if (e.flags.newItems > 0) {
    flags.push({ label: `${e.flags.newItems} new Pricelist ${e.flags.newItems === 1 ? "item" : "items"}` });
  }
  return flags;
}

function Flags({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map((f, i) => (
        <span
          // By position as well: two lines of one receipt can raise the same flag, word for word.
          key={`${i}-${f.label}`}
          className={`rounded-md px-2 py-0.5 text-support font-medium ${
            f.alert
              ? "bg-alert/10 text-alert-ink"
              : f.serious
                ? "bg-danger/10 text-danger"
                : "bg-gold/[0.18] text-gold-ink"
          }`}
        >
          {f.label}
        </span>
      ))}
    </div>
  );
}

function BudgetNotes({ notes }: { notes: ApprovalRow["budgetNotes"] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-support">
      {notes.map((n) => (
        <li key={n.text} className={n.over ? "text-danger" : "text-ink/70"}>
          {n.text}
        </li>
      ))}
    </ul>
  );
}

/** The submitter wrote this for whoever decides, so it is not hidden. */
function SubmitterNote({ expense: e }: { expense: ApprovalRow }) {
  if (!e.submitterComment) return null;
  return (
    <p className="rounded-md border border-gold/40 bg-gold/5 px-3 py-1.5 text-body">
      <span className="text-ink/70">Note from {e.submittedByName}: </span>
      <span className="whitespace-pre-wrap text-ink">{e.submitterComment}</span>
    </p>
  );
}

/** Vendor, amount, the facts that matter, and anything worth a second look — the head of a review. */
function ExpenseSummary({ expense: e, showSubmitter }: { expense: ApprovalRow; showSubmitter: boolean }) {
  const facts = [
    e.receipt_date ? formatPlainDate(e.receipt_date) : "No receipt date",
    `${e.lineItems.length} ${e.lineItems.length === 1 ? "line" : "lines"}`,
    e.hasReceipt ? "receipt attached" : "no receipt",
    showSubmitter ? e.submittedByName : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-semibold break-words text-ink">{e.vendor_name_raw ?? "Vendor not recorded"}</span>
            <Link
              href={`/expenses/${e.id}`}
              className="text-support font-medium tabular-nums text-brand underline-offset-2 hover:underline"
            >
              {e.expense_number ?? "View"}
            </Link>
          </p>
          <p className="mt-0.5 text-body text-ink/70">{facts.join(" · ")}</p>
        </div>
        <span className="text-lg font-semibold tabular-nums text-ink">{money(e.total)}</span>
      </div>

      <Flags flags={flagsOf(e)} />
      <BudgetNotes notes={e.budgetNotes} />
      <SubmitterNote expense={e} />
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
        <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-support text-ink/70">
          Reason for declining
          <input name="comment" required placeholder="Sent to whoever submitted it" className="input control text-body" />
        </label>
        <SubmitButton className="btn btn-danger control">Decline</SubmitButton>
        <button type="button" onClick={() => setDeclining(false)} className="btn btn-quiet control">
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
        <SubmitButton className="btn btn-approve control">{approveLabel}</SubmitButton>
      </form>
      <button type="button" onClick={() => setDeclining(true)} className="btn btn-danger control">
        Decline
      </button>
    </>
  );
}

function LineItemsTable({ lines }: { lines: ApprovalLineItem[] }) {
  if (lines.length === 0) return <p className="text-body text-ink/70">No line items recorded.</p>;
  return (
    // Scrolls on its own: five columns don't fit a phone, and the app shell
    // clips anything that runs past the screen.
    <div className="overflow-x-auto">
      <table className="min-w-full text-body">
        <thead>
          <tr className="border-b border-ink/15 text-left text-support text-ink/70">
            <th scope="col" className="py-1.5 pr-3 font-semibold">Description</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Category</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Qty</th>
            <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Unit price</th>
            <th scope="col" className="py-1.5 text-right font-semibold">Line total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((li, i) => (
            <tr key={i} className="border-b border-ink/[0.06] last:border-0">
              <td className="py-1.5 pr-3">{li.description_raw}</td>
              <td className="py-1.5 pr-3 text-ink/70">{li.categoryName}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{li.quantity ?? "—"}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{li.unit_price != null ? money(li.unit_price) : "—"}</td>
              <td className="py-1.5 text-right tabular-nums">{money(li.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Totals({ expense: e }: { expense: ApprovalRow }) {
  return (
    <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-ink/10 pt-2 text-body tabular-nums text-ink/70">
      <span>Subtotal: {money(e.subtotal)}</span>
      <span>GST: {money(e.gst_amount)}</span>
      <span className="font-semibold text-ink">Total: {money(e.total)}</span>
    </div>
  );
}

/** Which invoice, and who sent it when — the line above an expense's lines. */
function Provenance({ expense: e }: { expense: ApprovalRow }) {
  return (
    <p className="text-support text-ink/70">
      Invoice {e.invoice_number || "—"} · submitted {formatDate(e.created_at)} by {e.submittedByName}
    </p>
  );
}

/** The lines and totals, with the receipt drawn beside them rather than in a popup. */
function ExpenseDetails({ expense: e }: { expense: ApprovalRow }) {
  return (
    <div className={`grid grid-cols-1 gap-4 ${e.hasReceipt ? "lg:grid-cols-2" : ""}`}>
      <div className="flex min-w-0 flex-col gap-3">
        <Provenance expense={e} />
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
          <p className="text-body text-ink/70">Nothing left waiting for review.</p>
          <button type="button" onClick={onClose} className="btn btn-primary control">
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
              <Provenance expense={current} />
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
                className="btn btn-secondary control"
              >
                ← Previous
              </button>
              <button
                type="button"
                onClick={() => go(index + 1)}
                disabled={index >= rows.length - 1}
                className="btn btn-secondary control"
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

"use client";

import { SubmitButton } from "@/components/submit-button";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { useState } from "react";
import { withdrawExpense, bulkWithdrawExpenses } from "./actions";
import { formatDate, formatPlainDate } from "@/lib/format";
import { FilterableSection, type BulkAction, type SortOption } from "@/components/filterable-section";
import { LIST_ROW, ListFrame, RowDisclosure } from "@/components/list-frame";
import { ReceiptViewer } from "@/components/receipt-viewer";
import type { ExportColumn } from "@/lib/export";

export type SubmissionRow = {
  id: string;
  expense_number: string | null;
  vendor_name_raw: string | null;
  invoice_number: string | null;
  total: number;
  status: string;
  submitter_comment: string | null;
  decision_comment: string | null;
  decided_at: string | null;
  payment_reference: string | null;
  payment_date: string | null;
  created_at: string;
  hasReceipt: boolean;
};

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "expense_number", label: "Entry #" },
  { key: "vendor_name_raw", label: "Vendor" },
  { key: "invoice_number", label: "Invoice #" },
  { key: "total", label: "Total" },
  { key: "status", label: "Status" },
  { key: "submitter_comment", label: "My note" },
  { key: "decision_comment", label: "Comment" },
  { key: "payment_reference", label: "Payment reference" },
  { key: "payment_date", label: "Payment date" },
  { key: "created_at", label: "Submitted at" },
];

const SORT_OPTIONS: SortOption<SubmissionRow>[] = [
  { key: "created_at", label: "Submitted", value: (e) => e.created_at },
  { key: "total", label: "Total", value: (e) => e.total },
  { key: "status", label: "Status", value: (e) => e.status },
  { key: "vendor", label: "Vendor", value: (e) => e.vendor_name_raw ?? "" },
];

type Tab = "all" | "submitted" | "approved" | "paid" | "declined" | "withdrawn";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "submitted", label: "Waiting" },
  { key: "approved", label: "Approved" },
  { key: "paid", label: "Paid" },
  { key: "declined", label: "Declined" },
  { key: "withdrawn", label: "Withdrawn" },
];

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/**
 * The columns once there is room for a table: the tick box, the vendor, the
 * three dates an expense passes, its total, where it stands, and the arrow.
 */
const TABLE_COLUMNS = "@[62rem]:grid-cols-[1rem_minmax(0,1fr)_6.2rem_6.2rem_6.2rem_6.6rem_5.8rem_2rem]";

/**
 * A submitter's own expenses.
 *
 * Every expense was a full card — note, comments, receipt, Edit and Delete all
 * showing — so finding the one that needed something meant reading all of
 * them. Now each is a compact row with where it stands along
 * Submitted → Approved → Paid, the rest opening on a tap; tabs narrow the list
 * by status; and a declined expense sits at the top with its reason and a way
 * to fix it.
 *
 * On a screen with the room for it the rows are the lines of one table, the
 * three steps its date columns, and the list is drawn a page at a time — as
 * Approvals is, on the frame the two share.
 */
export function SubmissionsList({ expenses }: { expenses: SubmissionRow[] }) {
  // Opens on what needs doing: a declined expense, when there is one.
  const [tab, setTab] = useState<Tab>(() => (expenses.some((e) => e.status === "declined") ? "declined" : "all"));

  if (expenses.length === 0) {
    return (
      <p className="text-body text-ink/70">
        Nothing yet —{" "}
        <Link href="/submit" className="font-medium text-brand underline underline-offset-2">
          submit an expense
        </Link>
        .
      </p>
    );
  }

  const counts: Record<Tab, number> = {
    all: expenses.length,
    submitted: expenses.filter((e) => e.status === "submitted").length,
    approved: expenses.filter((e) => e.status === "approved").length,
    paid: expenses.filter((e) => e.status === "paid").length,
    declined: expenses.filter((e) => e.status === "declined").length,
    withdrawn: expenses.filter((e) => e.status === "withdrawn").length,
  };

  const inTab = tab === "all" ? expenses : expenses.filter((e) => e.status === tab);
  // Declined first on All: those are the ones waiting on the submitter.
  const ordered =
    tab === "all"
      ? [...inTab].sort((a, b) => Number(b.status === "declined") - Number(a.status === "declined"))
      : inTab;

  const bulkActions: BulkAction<SubmissionRow>[] = [
    {
      label: "Withdraw selected",
      variant: "danger",
      onClick: (selected) =>
        bulkWithdrawExpenses(selected.filter((e) => e.status === "submitted").map((e) => e.id)),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Show by status" className="tabs">
        {/* Withdrawn only appears once something has been withdrawn — for
            most people it would be an empty tab for ever. */}
        {TABS.filter((t) => t.key !== "withdrawn" || counts.withdrawn > 0).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className="tab cursor-pointer"
          >
            {t.label}
            <span className="ml-1.5 text-support font-normal tabular-nums text-ink/70">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <FilterableSection
        rows={ordered}
        searchText={(e) => `${e.vendor_name_raw ?? ""} ${e.invoice_number ?? ""} ${e.expense_number ?? ""} ${e.status}`}
        columns={EXPORT_COLUMNS}
        filenameBase="my-submissions"
        title="My submissions"
        placeholder="Filter by vendor, invoice, entry #…"
        bulkActions={bulkActions}
        amountOf={(e) => e.total}
        sortOptions={SORT_OPTIONS}
        pageKey="my-submissions"
        selectAllButton={false}
      >
        {(rows, selection, pager) =>
          rows.length === 0 ? (
            <p className="text-body text-ink/70">None here.</p>
          ) : (
            <ListFrame
              columns={TABLE_COLUMNS}
              selection={selection}
              rowCount={rows.length}
              pager={pager}
              headings={
                <>
                  <span>Vendor</span>
                  <span>Submitted</span>
                  <span>Decided</span>
                  <span>Paid</span>
                  <span className="text-right">Total</span>
                  <span>Status</span>
                  <span />
                </>
              }
            >
              {rows.map((e) => (
                <SubmissionRowItem
                  key={e.id}
                  expense={e}
                  selected={selection.isSelected(e.id)}
                  onSelect={() => selection.toggle(e.id)}
                />
              ))}
            </ListFrame>
          )
        }
      </FilterableSection>
    </div>
  );
}

/**
 * One submission.
 *
 * In a card: the vendor and total; the entry number, date and where it
 * stands; then the steps it has passed; and beside those two lines the arrow
 * that opens the rest.
 * In the table each of those is a column. Either way the whole row opens it,
 * not only the arrow — that is how the page has always worked.
 */
function SubmissionRowItem({
  expense: e,
  selected,
  onSelect,
}: {
  expense: SubmissionRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);

  const declined = e.status === "declined";
  const withdrawn = e.status === "withdrawn";
  const decided = e.decided_at && (declined || e.status === "approved" || e.status === "paid");
  const number = e.expense_number ?? "—";

  const status = <StatusBadge status={e.status} label={e.status === "submitted" ? "waiting" : undefined} />;

  // A cell placed by hand in the card, and left to fall into its column in the table.
  const inTable = "@[62rem]:col-start-auto @[62rem]:row-start-auto";

  return (
    <li
      className={`${LIST_ROW} cursor-pointer ${declined ? "border-danger/30" : ""}`}
      onClick={(event) => {
        // Anything that does something of its own keeps its click.
        if ((event.target as HTMLElement).closest("a, button, input, label, form")) return;
        setOpen((o) => !o);
      }}
    >
      <div
        className={`grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1.5 ${TABLE_COLUMNS}`}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={`Select ${e.expense_number ?? "submission"}`}
          className={`col-start-1 row-start-1 size-4 ${inTable}`}
        />

        <p className={`col-start-2 row-start-1 flex min-w-0 items-baseline gap-2 ${inTable}`}>
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

        <span className="hidden text-body tabular-nums text-ink/70 @[62rem]:block">{formatDate(e.created_at)}</span>
        <span className={`hidden text-body tabular-nums @[62rem]:block ${declined ? "text-danger" : "text-ink/70"}`}>
          {decided ? formatDate(e.decided_at!) : "—"}
        </span>
        <span className="hidden text-body tabular-nums text-ink/70 @[62rem]:block">
          {e.status === "paid" && e.payment_date ? formatPlainDate(e.payment_date) : "—"}
        </span>

        <span
          className={`col-start-3 row-start-1 text-right text-base font-semibold tabular-nums text-ink @[62rem]:text-body ${inTable}`}
        >
          {money(e.total)}
        </span>

        <span className="hidden @[62rem]:block">{status}</span>

        <RowDisclosure
          open={open}
          onToggle={() => setOpen((o) => !o)}
          label={`${open ? "Hide" : "Show"} the details of ${e.expense_number ?? "this submission"}`}
          className={`col-start-3 row-span-2 row-start-2 justify-self-end @[62rem]:row-span-1 ${inTable}`}
        />

        <p className="col-start-2 row-start-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-support text-ink/70 @[62rem]:hidden">
          <span>
            <Link
              href={`/expenses/${e.id}`}
              className="font-medium tabular-nums text-brand underline-offset-2 hover:underline"
            >
              {number}
            </Link>{" "}
            · {formatDate(e.created_at)}
          </span>
          {status}
        </p>

        <div className="col-start-2 row-start-3 @[62rem]:hidden">
          <Progress expense={e} />
        </div>

        {(declined || withdrawn || open) && (
          <div className="col-span-full flex flex-col gap-2 @[62rem]:pl-[1.875rem]">
            {declined && (
              <div className="flex flex-col gap-2 rounded-md bg-danger/5 px-3 py-2 text-body sm:flex-row sm:items-center sm:justify-between">
                <p className="text-danger">
                  {e.decision_comment
                    ? `Declined: ${e.decision_comment}`
                    : "Declined without a reason — fix and resubmit, or ask the Procurement Head."}
                </p>
                <Link href={`/submit?resubmit=${e.id}`} className="btn btn-primary btn-sm self-start pointer-coarse:min-h-10 sm:self-auto">
                  Fix and resubmit
                </Link>
              </div>
            )}

            {withdrawn && (
              <div className="flex flex-col gap-2 rounded-md bg-ink/5 px-3 py-2 text-body sm:flex-row sm:items-center sm:justify-between">
                <p className="text-ink/70">You withdrew this. It isn&apos;t counted anywhere, but stays on the record.</p>
                <Link href={`/submit?resubmit=${e.id}`} className="btn btn-secondary btn-sm self-start pointer-coarse:min-h-10 sm:self-auto">
                  Submit again
                </Link>
              </div>
            )}

            {open && <SubmissionDetails expense={e} />}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Where the expense is along Submitted → Approved → Paid, with the dates it
 * got to the later two. The day it was submitted is on the line above this
 * one, beside the entry number, and saying it twice wrapped the steps on a phone.
 */
function Progress({ expense: e }: { expense: SubmissionRow }) {
  const declined = e.status === "declined";
  const withdrawn = e.status === "withdrawn";
  const approvedOrPaid = e.status === "approved" || e.status === "paid";

  const steps: { label: string; date: string | null; done: boolean; bad?: boolean }[] = [
    { label: "Submitted", date: null, done: true },
    declined
      ? { label: "Declined", date: e.decided_at ? formatDate(e.decided_at) : null, done: true, bad: true }
      : withdrawn
        ? { label: "Withdrawn", date: null, done: true, bad: true }
        : { label: "Approved", date: e.decided_at && approvedOrPaid ? formatDate(e.decided_at) : null, done: approvedOrPaid },
  ];
  if (!declined && !withdrawn) {
    steps.push({
      label: "Paid",
      date: e.payment_date ? formatPlainDate(e.payment_date) : null,
      done: e.status === "paid",
    });
  }

  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-support" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden="true" className="text-ink/40">
              →
            </span>
          )}
          <span className={s.bad ? "text-danger" : s.done ? "font-medium text-palm-deep" : "text-ink/65"}>
            {s.done && !s.bad ? "✓ " : ""}
            {s.label}
            {s.done && s.date ? ` ${s.date}` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

function SubmissionDetails({ expense: e }: { expense: SubmissionRow }) {
  return (
    <div className="flex flex-col gap-2 border-t border-ink/10 pt-2.5 text-body">
      {e.invoice_number && <p className="text-support text-ink/70">Invoice {e.invoice_number}</p>}

      {/* The submitter's own note, so they can see what they said —
          particularly when a decision comes back referring to it. */}
      {e.submitter_comment && (
        <p className="rounded-md bg-ink/5 px-3 py-2 text-ink">
          <span className="text-ink/70">Your note: </span>
          <span className="whitespace-pre-wrap">{e.submitter_comment}</span>
        </p>
      )}

      {e.status === "approved" && e.decision_comment && (
        <p className="rounded-md bg-palm/5 px-3 py-2 text-palm-deep">Comment: {e.decision_comment}</p>
      )}

      {e.status === "paid" && (
        <p className="rounded-md bg-palm/5 px-3 py-2 text-ink/70">
          Paid {e.payment_date ? formatPlainDate(e.payment_date) : ""}
          {e.payment_reference && ` · Reference: ${e.payment_reference}`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/expenses/${e.id}`} className="btn btn-secondary btn-sm pointer-coarse:min-h-10">
          Open expense
        </Link>
        {e.hasReceipt && (
          <ReceiptViewer expenseId={e.id} label="Receipt" className="btn btn-secondary btn-sm pointer-coarse:min-h-10" />
        )}
        {e.status === "submitted" && (
          <>
            <Link href={`/submit?edit=${e.id}`} className="btn btn-secondary btn-sm pointer-coarse:min-h-10">
              Edit
            </Link>
            <form action={withdrawExpense}>
              <input type="hidden" name="expense_id" value={e.id} />
              <SubmitButton pendingLabel="Withdrawing…" className="btn btn-danger btn-sm pointer-coarse:min-h-10">
                Withdraw
              </SubmitButton>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

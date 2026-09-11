"use client";

import { SubmitButton } from "@/components/submit-button";
import Link from "next/link";
import { useState } from "react";
import { deleteExpense, bulkDeleteExpenses } from "./actions";
import { formatDate, formatPlainDate } from "@/lib/format";
import { FilterableSection, type BulkAction, type SortOption } from "@/components/filterable-section";
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

type Tab = "all" | "submitted" | "approved" | "paid" | "declined";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "submitted", label: "Waiting" },
  { key: "approved", label: "Approved" },
  { key: "paid", label: "Paid" },
  { key: "declined", label: "Declined" },
];

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/**
 * A submitter's own expenses.
 *
 * Every expense was a full card — note, comments, receipt, Edit and Delete all
 * showing — so finding the one that needed something meant reading all of
 * them. Now each is a compact row with where it stands along
 * Submitted → Approved → Paid, the rest opening on a tap; tabs narrow the list
 * by status; and a declined expense sits at the top with its reason and a way
 * to fix it.
 */
export function SubmissionsList({ expenses }: { expenses: SubmissionRow[] }) {
  // Opens on what needs doing: a declined expense, when there is one.
  const [tab, setTab] = useState<Tab>(() => (expenses.some((e) => e.status === "declined") ? "declined" : "all"));
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (expenses.length === 0) {
    return (
      <p className="text-sm text-ink/50">
        Nothing yet —{" "}
        <Link href="/submit" className="underline">
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
  };

  const inTab = tab === "all" ? expenses : expenses.filter((e) => e.status === tab);
  // Declined first on All: those are the ones waiting on the submitter.
  const ordered =
    tab === "all"
      ? [...inTab].sort((a, b) => Number(b.status === "declined") - Number(a.status === "declined"))
      : inTab;

  const bulkActions: BulkAction<SubmissionRow>[] = [
    {
      label: "Delete selected",
      variant: "danger",
      onClick: (selected) =>
        bulkDeleteExpenses(selected.filter((e) => e.status === "submitted").map((e) => e.id)),
    },
  ];

  function toggleOpen(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Show by status" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm transition-colors ${
              tab === t.key ? "bg-ink text-cream" : "bg-ink/5 text-ink/70 hover:bg-ink/10"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs opacity-70">{counts[t.key]}</span>
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
        sortOptions={SORT_OPTIONS}
      >
        {(rows, selection) =>
          rows.length === 0 ? (
            <p className="text-sm text-ink/50">None here.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((e) => {
                const isOpen = open.has(e.id);
                return (
                  <div
                    key={e.id}
                    className={`rounded-lg border bg-white/60 ${
                      e.status === "declined" ? "border-maroon/30" : "border-ink/10"
                    }`}
                  >
                    <div className="flex items-start gap-3 px-3 pt-3 sm:px-4">
                      <input
                        type="checkbox"
                        checked={selection.isSelected(e.id)}
                        onChange={() => selection.toggle(e.id)}
                        aria-label={`Select ${e.expense_number ?? "submission"}`}
                        className="mt-1"
                      />
                      <button
                        type="button"
                        onClick={() => toggleOpen(e.id)}
                        aria-expanded={isOpen}
                        className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-left"
                      >
                        <span className="min-w-0">
                          <span className="block font-medium break-words text-ink">
                            {e.vendor_name_raw ?? "Vendor not recorded"}
                          </span>
                          <span className="block text-xs text-ink/50">
                            <span className="font-mono">{e.expense_number ?? "—"}</span> · {formatDate(e.created_at)}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono text-ink">{money(e.total)}</span>
                          <StatusBadge status={e.status} />
                          <span aria-hidden="true" className="text-ink/40">
                            {isOpen ? "▾" : "▸"}
                          </span>
                        </span>
                      </button>
                    </div>

                    <div className="flex flex-col gap-2 px-3 pt-2 pb-3 pl-10 sm:px-4 sm:pl-11">
                      <Progress expense={e} />

                      {e.status === "declined" && (
                        <div className="flex flex-col gap-2 rounded-md bg-maroon/5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-maroon">
                            {e.decision_comment
                              ? `Declined: ${e.decision_comment}`
                              : "Declined without a reason — fix and resubmit, or ask the Procurement Head."}
                          </p>
                          <Link
                            href={`/submit?resubmit=${e.id}`}
                            className="self-start whitespace-nowrap rounded-md bg-gold px-3 py-1.5 text-sm font-medium text-ink hover:bg-gold-deep sm:self-auto"
                          >
                            Fix and resubmit
                          </Link>
                        </div>
                      )}

                      {isOpen && <SubmissionDetails expense={e} />}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        }
      </FilterableSection>
    </div>
  );
}

/** Where the expense is along Submitted → Approved → Paid, with the dates it got there. */
function Progress({ expense: e }: { expense: SubmissionRow }) {
  const declined = e.status === "declined";
  const approvedOrPaid = e.status === "approved" || e.status === "paid";

  const steps: { label: string; date: string | null; done: boolean; bad?: boolean }[] = [
    { label: "Submitted", date: formatDate(e.created_at), done: true },
    declined
      ? { label: "Declined", date: e.decided_at ? formatDate(e.decided_at) : null, done: true, bad: true }
      : { label: "Approved", date: e.decided_at && approvedOrPaid ? formatDate(e.decided_at) : null, done: approvedOrPaid },
  ];
  if (!declined) {
    steps.push({
      label: "Paid",
      date: e.payment_date ? formatPlainDate(e.payment_date) : null,
      done: e.status === "paid",
    });
  }

  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5">
          {i > 0 && (
            <span aria-hidden="true" className="text-ink/25">
              →
            </span>
          )}
          <span className={s.bad ? "text-maroon" : s.done ? "text-palm" : "text-ink/40"}>
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
    <div className="flex flex-col gap-2 border-t border-ink/10 pt-2 text-sm">
      {e.invoice_number && <p className="text-ink/60">Invoice {e.invoice_number}</p>}

      {/* The submitter's own note, so they can see what they said —
          particularly when a decision comes back referring to it. */}
      {e.submitter_comment && (
        <p className="rounded-md bg-ink/5 px-3 py-2 text-ink/70">
          <span className="text-ink/50">Your note: </span>
          <span className="whitespace-pre-wrap">{e.submitter_comment}</span>
        </p>
      )}

      {e.status === "approved" && e.decision_comment && (
        <p className="rounded-md bg-palm/5 px-3 py-2 text-palm">Comment: {e.decision_comment}</p>
      )}

      {e.status === "paid" && (
        <p className="rounded-md bg-palm/5 px-3 py-2 text-ink/70">
          Paid {e.payment_date ? formatPlainDate(e.payment_date) : ""}
          {e.payment_reference && ` · Reference: ${e.payment_reference}`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        <Link href={`/expenses/${e.id}`} className="-ml-2 px-2 py-1.5 text-ink/70 underline hover:text-ink">
          Open expense
        </Link>
        {e.hasReceipt && (
          <span className="px-2 py-1.5">
            <ReceiptViewer expenseId={e.id} label="Receipt" />
          </span>
        )}
        {e.status === "submitted" && (
          <>
            <Link href={`/submit?edit=${e.id}`} className="px-2 py-1.5 text-ink/70 underline hover:text-ink">
              Edit
            </Link>
            <form action={deleteExpense}>
              <input type="hidden" name="expense_id" value={e.id} />
              <SubmitButton className="px-2 py-1.5 text-maroon/70 underline hover:text-maroon">Delete</SubmitButton>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    submitted: "bg-gold/15 text-gold-deep",
    approved: "bg-palm/15 text-palm",
    declined: "bg-maroon/10 text-maroon",
    paid: "bg-ink/10 text-ink/70",
  };
  const labels: Record<string, string> = {
    submitted: "waiting",
    approved: "approved",
    declined: "declined",
    paid: "paid",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status] ?? ""}`}>{labels[status] ?? status}</span>
  );
}

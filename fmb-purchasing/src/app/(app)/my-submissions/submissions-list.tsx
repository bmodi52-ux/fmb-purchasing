"use client";

import { SubmitButton } from "@/components/submit-button";
import Link from "next/link";
import { deleteExpense, bulkDeleteExpenses } from "./actions";
import { formatDate } from "@/lib/format";
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

export function SubmissionsList({ expenses }: { expenses: SubmissionRow[] }) {
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

  const bulkActions: BulkAction<SubmissionRow>[] = [
    {
      label: "Delete selected",
      variant: "danger",
      onClick: (selected) =>
        bulkDeleteExpenses(selected.filter((e) => e.status === "submitted").map((e) => e.id)),
    },
  ];

  return (
    <FilterableSection
      rows={expenses}
      searchText={(e) => `${e.vendor_name_raw ?? ""} ${e.invoice_number ?? ""} ${e.status}`}
      columns={EXPORT_COLUMNS}
      filenameBase="my-submissions"
      title="My submissions"
      placeholder="Filter by vendor, invoice, status…"
      bulkActions={bulkActions}
      sortOptions={SORT_OPTIONS}
    >
      {(rows, selection) => (
        <div className="flex flex-col gap-3">
          {rows.map((e) => (
            <div key={e.id} className="rounded-lg border border-ink/10 bg-white/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selection.isSelected(e.id)}
                    onChange={() => selection.toggle(e.id)}
                    aria-label="Select submission"
                  />
                  <span className="font-mono text-xs text-ink/50">{e.expense_number ?? "—"}</span>
                  <span className="font-medium text-ink">{e.vendor_name_raw}</span>
                  <span className="ml-2 text-sm text-ink/50">{formatDate(e.created_at)}</span>
                </div>
                <div className="flex items-center gap-3">
                  {e.hasReceipt && <ReceiptViewer expenseId={e.id} label="Receipt" />}
                  <span className="font-mono text-ink">${e.total.toFixed(2)}</span>
                  <StatusBadge status={e.status} />
                </div>
              </div>

              {e.status === "declined" && (
                <p className="mt-2 rounded-md bg-maroon/5 px-3 py-2 text-sm text-maroon">
                  Declined — please contact FMB Procurement Head.
                  {e.decision_comment && <span className="block text-maroon/80">Comment: {e.decision_comment}</span>}
                </p>
              )}
              {e.status === "approved" && e.decision_comment && (
                <p className="mt-2 rounded-md bg-palm/5 px-3 py-2 text-sm text-palm">Comment: {e.decision_comment}</p>
              )}
              {e.status === "paid" && (
                <p className="mt-2 rounded-md bg-palm/5 px-3 py-2 text-sm text-ink/70">
                  Paid {e.payment_date ? formatDate(e.payment_date) : ""}
                  {e.payment_reference && ` · Reference: ${e.payment_reference}`}
                </p>
              )}

              {e.status === "submitted" && (
                <div className="mt-3 flex gap-3 text-sm">
                  <Link href={`/submit?edit=${e.id}`} className="text-ink/70 underline hover:text-ink">
                    Edit
                  </Link>
                  <form action={deleteExpense}>
                    <input type="hidden" name="expense_id" value={e.id} />
                    <SubmitButton className="text-maroon/70 underline hover:text-maroon">
                      Delete
                    </SubmitButton>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </FilterableSection>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    submitted: "bg-gold/15 text-gold-deep",
    approved: "bg-palm/15 text-palm",
    declined: "bg-maroon/10 text-maroon",
    paid: "bg-ink/10 text-ink/70",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs ${styles[status] ?? ""}`}>{status}</span>;
}

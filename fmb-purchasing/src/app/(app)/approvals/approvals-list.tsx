"use client";

import { reviewExpense, bulkReviewExpenses } from "./actions";
import { formatDate } from "@/lib/format";
import { FilterableSection, type BulkAction, type SortOption } from "@/components/filterable-section";
import { ReceiptViewer } from "@/components/receipt-viewer";
import type { ExportColumn } from "@/lib/export";

export type ApprovalLineItem = {
  description_raw: string;
  categoryName: string;
  quantity: number | null;
  unit_price: number | null;
  line_total: number;
};

export type ApprovalRow = {
  id: string;
  vendor_name_raw: string | null;
  invoice_number: string | null;
  receipt_date: string | null;
  subtotal: number;
  gst_amount: number;
  total: number;
  submittedByName: string;
  created_at: string;
  hasReceipt: boolean;
  lineItems: ApprovalLineItem[];
};

const EXPORT_COLUMNS: ExportColumn[] = [
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

export function ApprovalsList({ expenses }: { expenses: ApprovalRow[] }) {
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

  return (
    <FilterableSection
      rows={expenses}
      searchText={(e) => `${e.vendor_name_raw ?? ""} ${e.submittedByName} ${e.invoice_number ?? ""}`}
      columns={EXPORT_COLUMNS}
      filenameBase="approvals"
      title="Approvals"
      placeholder="Filter by vendor, submitter, invoice…"
      bulkActions={bulkActions}
      sortOptions={SORT_OPTIONS}
    >
      {(rows, selection) => (
        <div className="flex flex-col gap-3">
          {rows.map((e) => (
            <div key={e.id} className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={selection.isSelected(e.id)}
                onChange={() => selection.toggle(e.id)}
                aria-label="Select expense"
                className="mt-5"
              />
              <details className="flex-1 rounded-lg border border-ink/10 bg-white/60 p-4">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3">
                <div>
                  <span className="font-medium text-ink">{e.vendor_name_raw}</span>
                  <span className="ml-2 text-sm text-ink/50">
                    {e.submittedByName} · {formatDate(e.created_at)}
                  </span>
                </div>
                <span className="font-mono text-ink">${e.total.toFixed(2)}</span>
              </summary>

              <div className="mt-4 flex flex-col gap-4 border-t border-ink/10 pt-4">
                <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-ink/70">
                  <span>Invoice: {e.invoice_number || "—"}</span>
                  <span>Date: {e.receipt_date || "—"}</span>
                  {e.hasReceipt ? (
                    <ReceiptViewer expenseId={e.id} />
                  ) : (
                    <span className="text-ink/40">No receipt attached</span>
                  )}
                </div>

                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink/50">
                      <th className="p-1">Description</th>
                      <th className="p-1">Category</th>
                      <th className="p-1">Qty</th>
                      <th className="p-1">Unit price</th>
                      <th className="p-1">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.lineItems.map((li, i) => (
                      <tr key={i} className="border-t border-ink/5">
                        <td className="p-1">{li.description_raw}</td>
                        <td className="p-1 text-ink/60">{li.categoryName}</td>
                        <td className="p-1 font-mono">{li.quantity ?? "—"}</td>
                        <td className="p-1 font-mono">{li.unit_price != null ? `$${li.unit_price}` : "—"}</td>
                        <td className="p-1 font-mono">${li.line_total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex justify-end gap-6 border-t border-ink/10 pt-2 font-mono text-sm text-ink/70">
                  <span>Subtotal: ${e.subtotal.toFixed(2)}</span>
                  <span>GST: ${e.gst_amount.toFixed(2)}</span>
                  <span className="font-semibold text-ink">Total: ${e.total.toFixed(2)}</span>
                </div>

                <form action={reviewExpense} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="expense_id" value={e.id} />
                  <label className="flex flex-1 flex-col gap-1 text-sm">
                    <span className="text-ink/70">Comment (optional)</span>
                    <input name="comment" className="input" />
                  </label>
                  <button
                    type="submit"
                    name="decision"
                    value="approved"
                    className="rounded-md bg-palm/90 px-4 py-2 font-medium text-white hover:bg-palm"
                  >
                    Approve
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="declined"
                    className="rounded-md border border-maroon/40 px-4 py-2 font-medium text-maroon hover:bg-maroon/5"
                  >
                    Decline
                  </button>
                </form>
              </div>
              </details>
            </div>
          ))}
        </div>
      )}
    </FilterableSection>
  );
}

"use client";

import { useState } from "react";
import { markExpensePaid, bulkMarkPaid } from "./actions";
import { formatDate } from "@/lib/format";
import { FilterableSection } from "@/components/filterable-section";
import type { ExportColumn } from "@/lib/export";

export type PaymentRow = {
  id: string;
  vendor_name_raw: string | null;
  invoice_number: string | null;
  total: number;
  decided_at: string | null;
  submittedByName: string;
};

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "vendor_name_raw", label: "Vendor" },
  { key: "submittedByName", label: "Submitted by" },
  { key: "invoice_number", label: "Invoice" },
  { key: "decided_at", label: "Approved" },
  { key: "total", label: "Total" },
];

const today = new Date().toISOString().slice(0, 10);

function BulkPayBar({ ids, onDone, onClear }: { ids: string[]; onDone: () => void; onClear: () => void }) {
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      await bulkMarkPaid(ids, date, reference.trim() || null);
      onDone();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-gold/30 bg-gold/10 px-3 py-2 text-sm">
      <span className="text-ink/70">{ids.length} selected</span>
      <input
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder="Reference (optional)"
        className="input h-8 w-40 py-1 text-xs"
      />
      <input value={date} onChange={(e) => setDate(e.target.value)} type="date" className="input h-8 py-1 text-xs" />
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="rounded-md bg-gold px-3 py-1 text-xs font-medium text-ink hover:bg-gold-deep disabled:opacity-50"
      >
        {pending ? "…" : `Mark ${ids.length} paid`}
      </button>
      <button type="button" onClick={onClear} className="text-xs text-ink/50 hover:text-ink">
        Clear
      </button>
    </div>
  );
}

export function PaymentsTable({ expenses }: { expenses: PaymentRow[] }) {
  if (expenses.length === 0) {
    return <p className="text-sm text-ink/50">Nothing awaiting payment.</p>;
  }

  return (
    <FilterableSection
      rows={expenses}
      searchText={(e) => `${e.vendor_name_raw ?? ""} ${e.submittedByName} ${e.invoice_number ?? ""}`}
      columns={EXPORT_COLUMNS}
      filenameBase="payments"
      title="Payments"
      placeholder="Filter by vendor, submitter, invoice…"
    >
      {(rows, selection) => {
        const selectedIds = rows.filter((r) => selection.isSelected(r.id)).map((r) => r.id);
        return (
          <div className="flex flex-col gap-3">
            {selectedIds.length > 0 && (
              <BulkPayBar
                ids={selectedIds}
                onDone={() => selectedIds.forEach((id) => selection.toggle(id))}
                onClear={() => selectedIds.forEach((id) => selection.toggle(id))}
              />
            )}
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-ink/60">
                    <th className="p-2">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="p-2">Vendor</th>
                    <th className="p-2">Submitted by</th>
                    <th className="p-2">Invoice</th>
                    <th className="p-2">Approved</th>
                    <th className="p-2">Total</th>
                    <th className="p-2">Payment reference</th>
                    <th className="p-2">Payment date</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id} className="border-t border-ink/10">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selection.isSelected(e.id)}
                          onChange={() => selection.toggle(e.id)}
                          aria-label="Select expense"
                        />
                      </td>
                      <td className="p-2">{e.vendor_name_raw}</td>
                      <td className="p-2 text-ink/70">{e.submittedByName}</td>
                      <td className="p-2 text-ink/70">{e.invoice_number || "—"}</td>
                      <td className="p-2 text-ink/70">{e.decided_at ? formatDate(e.decided_at) : "—"}</td>
                      <td className="p-2 font-mono">${e.total.toFixed(2)}</td>
                      <td colSpan={3} className="p-2">
                        <form action={markExpensePaid} className="flex flex-wrap items-center gap-2">
                          <input type="hidden" name="expense_id" value={e.id} />
                          <input name="payment_reference" placeholder="Reference" className="input h-8 w-36 py-1 text-xs" />
                          <input
                            name="payment_date"
                            type="date"
                            defaultValue={today}
                            required
                            className="input h-8 py-1 text-xs"
                          />
                          <button
                            type="submit"
                            className="rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-ink hover:bg-gold-deep"
                          >
                            Mark paid
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }}
    </FilterableSection>
  );
}

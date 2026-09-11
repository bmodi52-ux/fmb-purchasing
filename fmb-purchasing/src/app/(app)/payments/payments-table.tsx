"use client";

import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { useState } from "react";
import { markExpensePaid, bulkMarkPaid } from "./actions";
import { formatDate } from "@/lib/format";
import { FilterableSection, type SortOption } from "@/components/filterable-section";
import { ReceiptViewer } from "@/components/receipt-viewer";
import type { ExportColumn } from "@/lib/export";
import { PayeeAccount } from "@/components/payee-account";
import type { PaymentInstruction } from "@/lib/payment-instruction";

export type PaymentRow = {
  id: string;
  expense_number: string | null;
  vendor_name_raw: string | null;
  invoice_number: string | null;
  total: number;
  decided_at: string | null;
  submittedByName: string;
  hasReceipt: boolean;
  /** "Possible duplicate of E-0123", when another expense has the same file or invoice. */
  duplicateWarning: string | null;
  /** Where the money goes, and whether anyone has vouched for the account. */
  payment: PaymentInstruction | null;
  payeeName: string;
  payeeAccount: string;
  payeeConfirmed: string;
};

const EXPORT_COLUMNS: ExportColumn[] = [
  { key: "expense_number", label: "Entry #" },
  { key: "vendor_name_raw", label: "Vendor" },
  { key: "payeeName", label: "Pay to" },
  { key: "payeeAccount", label: "Account" },
  { key: "payeeConfirmed", label: "Account status" },
  { key: "submittedByName", label: "Submitted by" },
  { key: "invoice_number", label: "Invoice" },
  { key: "decided_at", label: "Approved" },
  { key: "total", label: "Total" },
];

const SORT_OPTIONS: SortOption<PaymentRow>[] = [
  { key: "decided_at", label: "Approved", value: (e) => e.decided_at ?? "" },
  { key: "total", label: "Total", value: (e) => e.total },
  { key: "vendor", label: "Vendor", value: (e) => e.vendor_name_raw ?? "" },
  { key: "submitter", label: "Submitted by", value: (e) => e.submittedByName },
  // Unconfirmed accounts first: they are the rows that need a decision before
  // any transfer is made, and a run of thirty buries them otherwise.
  { key: "account", label: "Account status", value: (e) => (e.payment?.status === "pending" ? 0 : 1) },
];

const today = new Date().toISOString().slice(0, 10);

function BulkPayBar({ ids, onDone, onClear }: { ids: string[]; onDone: () => void; onClear: () => void }) {
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit() {
    setPending(true);
    setFailed(false);
    try {
      await bulkMarkPaid(ids, date, reference.trim() || null);
      onDone();
    } catch {
      // Recorded all together or not at all (0042), so nothing is half-paid.
      setFailed(true);
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
      {failed && (
        <p role="alert" className="basis-full text-xs text-maroon">
          The payment wasn&apos;t recorded, and nothing was marked paid. Try again.
        </p>
      )}
    </div>
  );
}

function DuplicateFlag({ label }: { label: string }) {
  return (
    <span className="mt-1 inline-block rounded-full bg-maroon/10 px-2 py-0.5 text-xs text-maroon">{label}</span>
  );
}

export function PaymentsTable({ expenses }: { expenses: PaymentRow[] }) {
  if (expenses.length === 0) {
    return <p className="text-sm text-ink/50">Nothing awaiting payment.</p>;
  }

  return (
    <FilterableSection
      rows={expenses}
      searchText={(e) =>
        `${e.vendor_name_raw ?? ""} ${e.payeeName} ${e.submittedByName} ${e.invoice_number ?? ""}`
      }
      columns={EXPORT_COLUMNS}
      filenameBase="payments"
      title="Payments"
      placeholder="Filter by vendor, submitter, invoice…"
      sortOptions={SORT_OPTIONS}
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
            {/* Phones: one card per expense. The table is twelve columns wide,
                and Mark paid sat at the far right of it. */}
            <ul className="flex flex-col gap-3 md:hidden">
              {rows.map((e) => (
                <li key={e.id} className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-white/60 p-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selection.isSelected(e.id)}
                        onChange={() => selection.toggle(e.id)}
                        aria-label="Select expense"
                        className="mt-1"
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{e.vendor_name_raw}</p>
                        {e.duplicateWarning && <DuplicateFlag label={e.duplicateWarning} />}
                        <p className="text-xs text-ink/55">
                          <Link href={`/expenses/${e.id}`} className="font-mono underline">
                            {e.expense_number ?? "View"}
                          </Link>
                          {" · "}
                          {e.submittedByName}
                          {e.invoice_number ? ` · Invoice ${e.invoice_number}` : ""}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-base font-semibold text-ink">${e.total.toFixed(2)}</span>
                  </div>

                  <div>
                    <p className="text-xs text-ink/50">Pay to</p>
                    <PayeeAccount instruction={e.payment} compact />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/55">
                    <span>Approved {e.decided_at ? formatDate(e.decided_at) : "—"}</span>
                    {e.hasReceipt ? <ReceiptViewer expenseId={e.id} /> : <span>No receipt</span>}
                  </div>

                  <form action={markExpensePaid} className="grid grid-cols-2 gap-2">
                    <input type="hidden" name="expense_id" value={e.id} />
                    <input
                      name="payment_reference"
                      placeholder="Payment reference"
                      aria-label="Payment reference"
                      className="input col-span-2"
                    />
                    <input
                      name="payment_date"
                      type="date"
                      defaultValue={today}
                      required
                      aria-label="Payment date"
                      className="input"
                    />
                    <SubmitButton className="rounded-md bg-gold px-3 py-2 text-sm font-medium text-ink hover:bg-gold-deep">
                      Mark paid
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-ink/60">
                    <th scope="col" className="p-2">
                      <span className="sr-only">Select</span>
                    </th>
                    <th scope="col" className="p-2">Entry #</th>
                    <th scope="col" className="p-2">Vendor</th>
                    <th scope="col" className="p-2">Pay to</th>
                    <th scope="col" className="p-2">Submitted by</th>
                    <th scope="col" className="p-2">Invoice</th>
                    <th scope="col" className="p-2">Receipt</th>
                    <th scope="col" className="p-2">Approved</th>
                    <th scope="col" className="p-2">Total</th>
                    <th scope="col" className="p-2">Payment reference</th>
                    <th scope="col" className="p-2">Payment date</th>
                    <th scope="col" className="p-2" />
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
                      <td className="p-2 font-mono text-xs"><Link href={`/expenses/${e.id}`} className="text-ink/70 underline">{e.expense_number ?? "View"}</Link></td>
                      <td className="p-2">
                        {e.vendor_name_raw}
                        {e.duplicateWarning && <DuplicateFlag label={e.duplicateWarning} />}
                      </td>
                      <td className="p-2"><PayeeAccount instruction={e.payment} compact /></td>
                      <td className="p-2 text-ink/70">{e.submittedByName}</td>
                      <td className="p-2 text-ink/70">{e.invoice_number || "—"}</td>
                      <td className="p-2">{e.hasReceipt ? <ReceiptViewer expenseId={e.id} /> : <span className="text-ink/40">—</span>}</td>
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
                          <SubmitButton className="rounded-md bg-gold px-3 py-1.5 text-xs font-medium text-ink hover:bg-gold-deep">
                            Mark paid
                          </SubmitButton>
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

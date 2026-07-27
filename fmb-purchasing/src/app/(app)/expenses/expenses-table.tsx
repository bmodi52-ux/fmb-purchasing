"use client";

import { ColumnsDataTable, type ColumnDef } from "@/components/columns-data-table";
import { ReceiptViewer } from "@/components/receipt-viewer";
import { formatDate } from "@/lib/format";
import { formatFiscalYear } from "@/lib/fiscal-year";

export type ExpenseRow = {
  id: string;
  vendor_name_raw: string | null;
  vendorNumber: string | null;
  submittedByName: string;
  status: string;
  invoice_number: string | null;
  receipt_date: string | null;
  hasReceipt: boolean;
  subtotal: number;
  gst_amount: number;
  total: number;
  fiscal_year_hijri: number;
  decidedByName: string | null;
  decided_at: string | null;
  payment_reference: string | null;
  payment_date: string | null;
  created_at: string;
};

const ALL_COLUMNS: ColumnDef<ExpenseRow>[] = [
  { key: "vendor", label: "Vendor", render: (r) => r.vendor_name_raw ?? "—", exportValue: (r) => r.vendor_name_raw ?? "" },
  {
    key: "vendor_number",
    label: "Vendor #",
    render: (r) => <span className="font-mono">{r.vendorNumber ?? "—"}</span>,
    exportValue: (r) => r.vendorNumber ?? "",
  },
  { key: "submitted_by", label: "Submitted by", render: (r) => r.submittedByName, exportValue: (r) => r.submittedByName },
  { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
  { key: "invoice_number", label: "Invoice #", render: (r) => r.invoice_number ?? "—", exportValue: (r) => r.invoice_number ?? "" },
  { key: "receipt_date", label: "Receipt date", render: (r) => r.receipt_date ?? "—", exportValue: (r) => r.receipt_date ?? "" },
  {
    key: "receipt",
    label: "Receipt",
    render: (r) => (r.hasReceipt ? <ReceiptViewer expenseId={r.id} /> : "—"),
    exportValue: (r) => (r.hasReceipt ? "attached" : ""),
  },
  { key: "subtotal", label: "Subtotal", render: (r) => `$${r.subtotal.toFixed(2)}`, exportValue: (r) => r.subtotal },
  { key: "gst_amount", label: "GST", render: (r) => `$${r.gst_amount.toFixed(2)}`, exportValue: (r) => r.gst_amount },
  { key: "total", label: "Total", render: (r) => `$${r.total.toFixed(2)}`, exportValue: (r) => r.total },
  {
    key: "fiscal_year",
    label: "Fiscal year (H)",
    render: (r) => formatFiscalYear(r.fiscal_year_hijri),
    exportValue: (r) => formatFiscalYear(r.fiscal_year_hijri),
  },
  { key: "decided_by", label: "Decided by", render: (r) => r.decidedByName ?? "—", exportValue: (r) => r.decidedByName ?? "" },
  {
    key: "decided_at",
    label: "Decided at",
    render: (r) => (r.decided_at ? formatDate(r.decided_at) : "—"),
    exportValue: (r) => (r.decided_at ? formatDate(r.decided_at) : ""),
  },
  { key: "payment_reference", label: "Payment reference", render: (r) => r.payment_reference ?? "—", exportValue: (r) => r.payment_reference ?? "" },
  { key: "payment_date", label: "Payment date", render: (r) => r.payment_date ?? "—", exportValue: (r) => r.payment_date ?? "" },
  { key: "created_at", label: "Submitted at", render: (r) => formatDate(r.created_at), exportValue: (r) => formatDate(r.created_at) },
];

export function ExpensesTable({ rows, initialVisible }: { rows: ExpenseRow[]; initialVisible: string[] }) {
  return (
    <ColumnsDataTable
      pageKey="all_expenses"
      title="All expenses"
      columns={ALL_COLUMNS}
      rows={rows}
      initialVisible={initialVisible}
      emptyLabel="No expenses yet."
    />
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

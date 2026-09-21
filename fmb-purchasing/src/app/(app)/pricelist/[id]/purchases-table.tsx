"use client";

import Link from "next/link";
import { ColumnsDataTable, type ColumnDef } from "@/components/columns-data-table";
import { ReceiptViewer } from "@/components/receipt-viewer";
import { formatDate } from "@/lib/format";

export type PurchaseRow = {
  id: string;
  expenseId: string;
  expenseNumber: string | null;
  /** Whether this viewer may open the expense and its receipt. */
  canOpen: boolean;
  hasReceipt: boolean;
  receiptDate: string | null;
  vendorName: string;
  invoiceNumber: string | null;
  description: string;
  packLabel: string;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number;
  /** Already formatted, "$3.71/kg" — null when the line can't be priced per unit. */
  costPerUnit: string | null;
  costPerUnitValue: number | null;
  status: string;
  submittedByName: string;
};

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

const ALL_COLUMNS: ColumnDef<PurchaseRow>[] = [
  {
    key: "receipt_date",
    label: "Date",
    render: (r) => (r.receiptDate ? formatDate(r.receiptDate) : "—"),
    exportValue: (r) => (r.receiptDate ? formatDate(r.receiptDate) : ""),
    // Displayed day-first, which sorts wrongly as text.
    sortValue: (r) => r.receiptDate ?? "",
  },
  {
    key: "expense_number",
    label: "Entry #",
    render: (r) =>
      r.canOpen ? (
        <Link href={`/expenses/${r.expenseId}`} className="font-mono text-ink underline">
          {r.expenseNumber ?? "View"}
        </Link>
      ) : (
        <span className="font-mono">{r.expenseNumber ?? "—"}</span>
      ),
    exportValue: (r) => r.expenseNumber ?? "",
  },
  { key: "vendor", label: "Vendor", render: (r) => r.vendorName, exportValue: (r) => r.vendorName },
  {
    key: "invoice_number",
    label: "Invoice #",
    render: (r) => r.invoiceNumber ?? "—",
    exportValue: (r) => r.invoiceNumber ?? "",
  },
  {
    key: "description",
    label: "On the receipt",
    render: (r) => r.description || "—",
    exportValue: (r) => r.description,
  },
  { key: "pack", label: "Pack size", render: (r) => r.packLabel, exportValue: (r) => r.packLabel },
  {
    key: "quantity",
    label: "Qty",
    render: (r) => (r.quantity == null ? "—" : r.quantity),
    exportValue: (r) => r.quantity ?? "",
  },
  {
    key: "unit_price",
    label: "Price each",
    render: (r) => (r.unitPrice == null ? "—" : money(r.unitPrice)),
    exportValue: (r) => r.unitPrice ?? "",
  },
  {
    key: "line_total",
    label: "Line total",
    render: (r) => money(r.lineTotal),
    exportValue: (r) => r.lineTotal,
  },
  {
    key: "cost_per_unit",
    label: "Cost per unit",
    render: (r) => <span className="font-mono">{r.costPerUnit ?? "—"}</span>,
    exportValue: (r) => r.costPerUnit ?? "",
    sortValue: (r) => r.costPerUnitValue ?? -1,
  },
  {
    key: "receipt",
    label: "Receipt",
    render: (r) => (r.canOpen && r.hasReceipt ? <ReceiptViewer expenseId={r.expenseId} /> : "—"),
    exportValue: (r) => (r.hasReceipt ? "attached" : ""),
  },
  { key: "status", label: "Status", render: (r) => r.status, exportValue: (r) => r.status },
  {
    key: "submitted_by",
    label: "Submitted by",
    render: (r) => r.submittedByName,
    exportValue: (r) => r.submittedByName,
  },
];

export const PURCHASES_DEFAULT_VISIBLE = [
  "receipt_date",
  "expense_number",
  "vendor",
  "description",
  "pack",
  "quantity",
  "unit_price",
  "line_total",
  "cost_per_unit",
  "receipt",
];

/**
 * Every receipt line filed against one item (#80): the purchases behind the
 * figures on Overview, each a way back to the expense and the receipt.
 */
export function PurchasesTable({ rows, initialVisible }: { rows: PurchaseRow[]; initialVisible: string[] }) {
  return (
    <ColumnsDataTable
      pageKey="item_purchases"
      title="Purchases"
      columns={ALL_COLUMNS}
      rows={rows}
      initialVisible={initialVisible}
      amountOf={(r) => r.lineTotal}
      emptyLabel="No purchases recorded against this item yet."
    />
  );
}

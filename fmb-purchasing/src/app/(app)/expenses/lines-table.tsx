"use client";

import Link from "next/link";
import { ColumnsDataTable, type ColumnDef } from "@/components/columns-data-table";
import { formatDate } from "@/lib/format";
import { LINE_KIND_LABELS } from "../submit/reconciliation-strip";
import type { StoredLineKind } from "@/lib/line-kinds";

export type LineRow = {
  id: string;
  expenseId: string;
  expenseNumber: string | null;
  vendorName: string;
  receiptDate: string | null;
  status: string;
  submittedByName: string;
  kind: StoredLineKind;
  description: string;
  itemName: string | null;
  categoryName: string;
  quantity: number | null;
  unitPrice: number | null;
  lineSubtotal: number;
  lineGst: number;
  lineTotal: number;
};

const money = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/**
 * Every line of every expense, as one ledger.
 *
 * The expense-level table answers "what did we pay Foodworks", and nothing
 * answered "what did we buy". Reports aggregates lines already, but a rollup
 * cannot be scanned, sorted or exported the way a transaction list can, so the
 * question was being answered by exporting and pivoting elsewhere.
 *
 * Charges appear alongside goods and services rather than being hidden. That
 * keeps the ledger summing to exactly the figure the expense view shows —
 * which is the invariant migration 0026 exists to protect, and what makes this
 * page reconcilable against a bank statement. The Type column is there to
 * filter them out when the question really is only about purchases.
 */
const ALL_COLUMNS: ColumnDef<LineRow>[] = [
  {
    key: "expense_number",
    label: "Entry #",
    render: (r) => (
      <Link href={`/expenses/${r.expenseId}`} className="font-mono text-ink underline">
        {r.expenseNumber ?? "View"}
      </Link>
    ),
    exportValue: (r) => r.expenseNumber ?? "",
  },
  {
    key: "receipt_date",
    label: "Date",
    render: (r) => (r.receiptDate ? formatDate(r.receiptDate) : "—"),
    exportValue: (r) => (r.receiptDate ? formatDate(r.receiptDate) : ""),
    // Displayed day-first, which sorts wrongly as text.
    sortValue: (r) => r.receiptDate ?? "",
  },
  {
    key: "vendor",
    label: "Vendor",
    render: (r) => r.vendorName,
    exportValue: (r) => r.vendorName,
  },
  {
    key: "kind",
    label: "Type",
    render: (r) => LINE_KIND_LABELS[r.kind] ?? r.kind,
    exportValue: (r) => LINE_KIND_LABELS[r.kind] ?? r.kind,
  },
  {
    key: "description",
    label: "Description",
    // What the receipt said, which is what a person recognises. The matched
    // catalogue item is shown beside it when the two differ, because the whole
    // point of matching is that "URID GOTA 1KG" and "Urid Gota" are one thing.
    render: (r) => (
      <>
        <span className="text-ink">{r.description}</span>
        {r.itemName && r.itemName !== r.description && (
          <span className="ml-1 text-xs text-ink/40">({r.itemName})</span>
        )}
      </>
    ),
    exportValue: (r) => r.description,
  },
  {
    key: "item",
    label: "Item",
    render: (r) => r.itemName ?? "—",
    exportValue: (r) => r.itemName ?? "",
  },
  {
    key: "category",
    label: "Category",
    render: (r) => r.categoryName,
    exportValue: (r) => r.categoryName,
  },
  {
    key: "quantity",
    label: "Qty",
    render: (r) => (r.quantity == null ? "—" : r.quantity),
    exportValue: (r) => r.quantity ?? "",
  },
  {
    key: "unit_price",
    label: "Unit price",
    render: (r) => (r.unitPrice == null ? "—" : money(r.unitPrice)),
    exportValue: (r) => r.unitPrice ?? "",
  },
  {
    key: "line_subtotal",
    label: "Subtotal",
    render: (r) => money(r.lineSubtotal),
    exportValue: (r) => r.lineSubtotal,
  },
  {
    key: "line_gst",
    label: "GST",
    render: (r) => money(r.lineGst),
    exportValue: (r) => r.lineGst,
  },
  {
    key: "line_total",
    label: "Line total",
    render: (r) => money(r.lineTotal),
    exportValue: (r) => r.lineTotal,
  },
  {
    key: "status",
    label: "Status",
    render: (r) => r.status,
    exportValue: (r) => r.status,
  },
  {
    key: "submitted_by",
    label: "Submitted by",
    render: (r) => r.submittedByName,
    exportValue: (r) => r.submittedByName,
  },
];

export function LinesTable({
  rows,
  initialVisible,
}: {
  rows: LineRow[];
  initialVisible: string[];
}) {
  const total = rows.reduce((sum, r) => sum + r.lineTotal, 0);

  return (
    <div className="flex flex-col gap-3">
      <ColumnsDataTable
        pageKey="expense_lines"
        title="Expense lines"
        columns={ALL_COLUMNS}
        rows={rows}
        initialVisible={initialVisible}
        emptyLabel="No line items in this period."
      />
      {/* The sum of everything loaded, not of what the filters leave — the
          table owns that state. Stated so the page can be checked against the
          expense view, which is the reason charges are listed here at all. */}
      <p className="text-xs text-ink/50">
        {rows.length.toLocaleString()} lines, {money(total)} in total before filtering.
      </p>
    </div>
  );
}

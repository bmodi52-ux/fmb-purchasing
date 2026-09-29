/**
 * The Accounting page's GST figures as downloadable tables — the summary as
 * it goes on the return, and the detail behind it: every line, its tax type,
 * and any doubt about the claim. Nothing listed the lines behind 1B before,
 * so a figure on the return could not be traced without rebuilding it by
 * hand. Pure.
 */

import { xeroTaxType, type GstExpense, type GstSummary } from "@/lib/gst-summary";
import type { XeroBillLine } from "@/lib/xero-export";
import type { ReportTable } from "./tables.ts";

export function gstTables(summary: GstSummary, expenses: GstExpense[], lines: XeroBillLine[]): ReportTable[] {
  const concernsByNumber = new Map(
    summary.concerns.map((c) => [c.expense.expenseNumber ?? c.expense.id, c.reasons.join("; ")])
  );
  const late = new Set(summary.adjustments.map((e) => e.expenseNumber ?? e.id));
  const cents = (n: number) => Math.round(n * 100) / 100;

  return [
    {
      title: "GST detail",
      columns: [
        { key: "entry", label: "Entry", kind: "text" },
        { key: "invoice", label: "Invoice", kind: "text" },
        { key: "date", label: "Date", kind: "date" },
        { key: "vendor", label: "Vendor", kind: "text" },
        { key: "description", label: "Description", kind: "text" },
        { key: "capital", label: "Capital", kind: "text" },
        { key: "taxType", label: "Tax type", kind: "text" },
        { key: "amount", label: "Amount (GST incl.)", kind: "money" },
        { key: "gst", label: "GST", kind: "money" },
        { key: "note", label: "Note", kind: "text" },
      ],
      rows: lines.map((l) => {
        const entry = l.expenseNumber ?? "";
        const notes = [concernsByNumber.get(entry), late.has(entry) ? "Approved after its period was lodged" : null];
        return {
          entry,
          invoice: l.invoiceNumber ?? "",
          date: l.invoiceDate,
          vendor: l.contactName,
          description: l.description,
          capital: l.isCapital ? "yes" : "",
          taxType: xeroTaxType(l),
          amount: l.lineTotal,
          gst: l.gst,
          note: notes.filter(Boolean).join("; "),
        };
      }),
      totals: {
        entry: "Total",
        amount: cents(lines.reduce((s, l) => s + l.lineTotal, 0)),
        gst: cents(lines.reduce((s, l) => s + l.gst, 0)),
      },
    },
    {
      title: "GST summary",
      columns: [
        { key: "label", label: "", kind: "text" },
        { key: "amount", label: "Amount", kind: "money" },
      ],
      rows: [
        { label: "G11 · Other purchases (GST included)", amount: summary.g11 },
        { label: "G10 · Capital purchases (GST included)", amount: summary.g10 },
        { label: "1B · GST on purchases", amount: summary.oneB },
        { label: "GST-free purchases, within G10 and G11", amount: summary.gstFreePurchases },
      ],
    },
    {
      title: "GST to check",
      columns: [
        { key: "entry", label: "Entry", kind: "text" },
        { key: "vendor", label: "Vendor", kind: "text" },
        { key: "total", label: "Total", kind: "money" },
        { key: "gst", label: "GST", kind: "money" },
        { key: "reason", label: "Why", kind: "text" },
      ],
      rows: [
        ...summary.concerns.map(({ expense, reasons }) => ({
          entry: expense.expenseNumber ?? "",
          vendor: expense.vendorName,
          total: expense.total,
          gst: expense.gst,
          reason: reasons.join("; "),
        })),
        ...summary.adjustments.map((e) => ({
          entry: e.expenseNumber ?? "",
          vendor: e.vendorName,
          total: e.total,
          gst: e.gst,
          reason: "Approved after its period was lodged — an adjustment for the next return",
        })),
      ],
    },
    {
      title: "Expenses",
      columns: [
        { key: "entry", label: "Entry", kind: "text" },
        { key: "vendor", label: "Vendor", kind: "text" },
        { key: "total", label: "Total", kind: "money" },
        { key: "gst", label: "GST", kind: "money" },
        { key: "receipt", label: "Receipt on file", kind: "text" },
        { key: "abn", label: "Vendor ABN", kind: "text" },
      ],
      rows: expenses.map((e) => ({
        entry: e.expenseNumber ?? "",
        vendor: e.vendorName,
        total: e.total,
        gst: e.gst,
        receipt: e.hasAttachment ? "yes" : "no",
        abn: e.vendorAbn ?? "",
      })),
      totals: {
        entry: "Total",
        total: cents(expenses.reduce((s, e) => s + e.total, 0)),
        gst: cents(expenses.reduce((s, e) => s + e.gst, 0)),
      },
    },
  ];
}

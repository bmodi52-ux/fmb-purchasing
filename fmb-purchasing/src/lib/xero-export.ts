import { xeroTaxType } from "@/lib/gst-summary";

/**
 * A bills file for Xero's purchases import (scratchpad #38).
 *
 * The first, file-based step of the Xero integration: approved and paid
 * expenses as draft bills, one bill per expense and one row per line, with the
 * category's account code and a tax type worked out from the line's own GST
 * and capital flags. Amounts are GST inclusive, as receipts are — choose "Tax
 * inclusive" when Xero's import asks.
 *
 * How purchases reach Xero today, and cash or accrual GST, are still to be
 * confirmed (#38); this file is deliberately the plain bills template so it
 * suits either, and the live connection is planned in docs/xero-integration.md.
 */

export type XeroBillLine = {
  expenseNumber: string | null;
  invoiceNumber: string | null;
  contactName: string;
  invoiceDate: string;
  dueDate: string;
  description: string;
  lineTotal: number;
  gst: number;
  isCapital: boolean;
  accountCode: string | null;
};

export const XERO_COLUMNS = [
  "*ContactName",
  "EmailAddress",
  "*InvoiceNumber",
  "Reference",
  "*InvoiceDate",
  "*DueDate",
  "*Description",
  "*Quantity",
  "*UnitAmount",
  "*AccountCode",
  "*TaxType",
  "Currency",
];

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Xero's import reads dates as DD/MM/YYYY for an Australian organisation. */
function xeroDate(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function buildXeroBillsCsv(lines: XeroBillLine[]): string {
  const rows = lines.map((l) =>
    [
      l.contactName,
      "",
      // Xero wants each bill's number unique; a vendor's own invoice number is
      // not always, so the entry number goes first.
      [l.expenseNumber, l.invoiceNumber].filter(Boolean).join(" / ") || "No number",
      l.expenseNumber ?? "",
      xeroDate(l.invoiceDate),
      xeroDate(l.dueDate),
      l.description || "Expense",
      1,
      l.lineTotal.toFixed(2),
      l.accountCode ?? "",
      xeroTaxType(l),
      "AUD",
    ]
      .map(csvCell)
      .join(",")
  );
  return [XERO_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

/** Lines that would import without an account code, which Xero refuses. */
export function linesMissingAccountCodes(lines: XeroBillLine[]): number {
  return lines.filter((l) => !l.accountCode).length;
}

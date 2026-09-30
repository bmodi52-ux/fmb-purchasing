/**
 * The Accounting page's figures, from the same ledger every report reads.
 *
 * Accounting used to fetch its own copy of the expenses and lines, naming
 * vendors and dating expenses by its own rules. Now it takes the ledger and
 * adds only what is its alone: which expenses have a receipt on file, each
 * vendor's ABN and GST registration, the lodged periods, and account codes.
 * Pure, so the GST return's figures are reconciled against the ledger in
 * reconciliation.test.ts.
 */

import type { GstExpense, GstLine } from "@/lib/gst-summary";
import type { XeroBillLine } from "@/lib/xero-export";
import type { Ledger } from "./ledger-rows.ts";

export type AccountingExtras = {
  /** Expenses with at least one attachment. */
  withReceipt: Set<string>;
  vendors: Map<string, { abn: string | null; gst_registered: boolean | null }>;
  /** Periods locked and not unlocked. */
  locks: { start_date: string; end_date: string; locked_at: string }[];
  accountCodeByCategory: Map<string, string | null>;
};

export function accountingFromLedger(
  ledger: Ledger,
  extras: AccountingExtras
): { gstExpenses: GstExpense[]; gstLines: GstLine[]; xeroLines: XeroBillLine[] } {
  const gstExpenses: GstExpense[] = ledger.expenses.map((e) => {
    const vendor = e.vendorId ? extras.vendors.get(e.vendorId) : undefined;
    return {
      id: e.id,
      expenseNumber: e.expenseNumber,
      vendorName: e.vendorName,
      total: e.total,
      gst: e.gst,
      hasAttachment: extras.withReceipt.has(e.id),
      vendorAbn: vendor?.abn ?? null,
      vendorGstRegistered: vendor?.gst_registered ?? null,
      // Dated inside a period that was already lodged when it was approved.
      lateForLockedPeriod: extras.locks.some(
        (l) =>
          e.reportDate >= l.start_date && e.reportDate <= l.end_date && !!e.decidedAt && e.decidedAt > l.locked_at
      ),
    };
  });

  const gstLines: GstLine[] = ledger.lines.map((l) => ({
    expenseId: l.expenseId,
    lineTotal: l.lineTotal,
    gst: l.gst,
    isCapital: l.isCapital,
    gstApportioned: l.gstApportioned,
  }));

  const expenseById = new Map(ledger.expenses.map((e) => [e.id, e]));
  const xeroLines: XeroBillLine[] = ledger.lines.map((l) => {
    const e = expenseById.get(l.expenseId)!;
    return {
      expenseId: e.id,
      expenseNumber: e.expenseNumber,
      invoiceNumber: e.invoiceNumber,
      contactName: e.vendorName,
      invoiceDate: e.reportDate,
      dueDate: e.paymentDate ?? e.reportDate,
      description: l.description,
      lineTotal: l.lineTotal,
      gst: l.gst,
      isCapital: l.isCapital,
      accountCode: l.categoryId ? (extras.accountCodeByCategory.get(l.categoryId) ?? null) : null,
    };
  });

  return { gstExpenses, gstLines, xeroLines };
}

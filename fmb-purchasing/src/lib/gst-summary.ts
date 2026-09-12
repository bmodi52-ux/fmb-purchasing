/**
 * The GST figures for a period, laid out like the return (scratchpad #38).
 *
 *   G10  capital purchases, GST included
 *   G11  other purchases, GST included
 *   1B   GST on purchases
 *
 * Built from lines, because GST is a property of the line (0026) and capital
 * is too (0048). Pure, so the figure a person copies onto a return is tested.
 *
 * Tax rules worth confirming with FMB's accountant before relying on them: a
 * GST credit over $82.50 (GST included) needs a tax invoice, and GST charged by
 * a business not registered for GST cannot be claimed.
 */

export type GstLine = {
  expenseId: string;
  lineTotal: number;
  gst: number;
  isCapital: boolean;
  gstApportioned: boolean;
};

export type GstExpense = {
  id: string;
  expenseNumber: string | null;
  vendorName: string;
  total: number;
  gst: number;
  hasAttachment: boolean;
  vendorAbn: string | null;
  vendorGstRegistered: boolean | null;
  /** Dated inside a period that was already locked when it was approved — an adjustment for this return. */
  lateForLockedPeriod: boolean;
};

export const TAX_INVOICE_THRESHOLD = 82.5;

/** Whether an expense claims GST that the paperwork on file may not support. */
export function mayLackTaxInvoice(e: Pick<GstExpense, "gst" | "total" | "hasAttachment" | "vendorAbn">): boolean {
  if (e.gst <= 0 || e.total <= TAX_INVOICE_THRESHOLD) return false;
  return !e.hasAttachment || !e.vendorAbn;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type GstSummary = {
  g10: number;
  g11: number;
  oneB: number;
  gstFreePurchases: number;
  expenseCount: number;
  /** Expenses whose GST credit may not be claimable, and why. */
  concerns: { expense: GstExpense; reasons: string[] }[];
  /** Lines whose GST was shared out across the receipt, before per-line GST. */
  apportionedLines: number;
  /** Receipts dated in a lodged period, approved since — adjustments. */
  adjustments: GstExpense[];
};

export function summariseGst(expenses: GstExpense[], lines: GstLine[]): GstSummary {
  const ids = new Set(expenses.map((e) => e.id));
  const inScope = lines.filter((l) => ids.has(l.expenseId));

  let g10 = 0;
  let g11 = 0;
  let oneB = 0;
  let gstFree = 0;
  for (const l of inScope) {
    if (l.isCapital) g10 += l.lineTotal;
    else g11 += l.lineTotal;
    oneB += l.gst;
    if (l.gst === 0) gstFree += l.lineTotal;
  }

  const concerns = expenses
    .map((e) => {
      const reasons: string[] = [];
      if (mayLackTaxInvoice(e)) {
        reasons.push(!e.hasAttachment ? "No receipt on file for GST over $82.50" : "Vendor has no ABN recorded for GST over $82.50");
      }
      if (e.gst > 0 && e.vendorGstRegistered === false) reasons.push("GST charged by a vendor not registered for GST");
      return { expense: e, reasons };
    })
    .filter((c) => c.reasons.length > 0);

  return {
    g10: round2(g10),
    g11: round2(g11),
    oneB: round2(oneB),
    gstFreePurchases: round2(gstFree),
    expenseCount: expenses.length,
    concerns,
    apportionedLines: inScope.filter((l) => l.gstApportioned && l.gst !== 0).length,
    adjustments: expenses.filter((e) => e.lateForLockedPeriod),
  };
}

/**
 * The Xero tax type for a line, from what the line already knows: whether GST
 * applies and whether it is capital. These are Xero's Australian codes.
 */
export function xeroTaxType(line: Pick<GstLine, "gst" | "isCapital">): string {
  if (line.isCapital) return line.gst > 0 ? "CAPEXINPUT" : "EXEMPTCAPITAL";
  return line.gst > 0 ? "INPUT" : "EXEMPTEXPENSES";
}

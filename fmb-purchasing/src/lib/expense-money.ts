import type { LineKind } from "@/lib/receipt-extraction";

/**
 * The arithmetic that decides what an expense is worth, and whether it adds
 * up. Pure functions over plain values, like reports/aggregate.ts and for the
 * same reason: this is the part someone will quote to an accountant, so it
 * gets tests rather than being spread through a form component.
 *
 * Two rules are enforced here, both new in migration 0026.
 *
 * THE TOTAL IS CAPTURED, THE LINES MUST ACCOUNT FOR IT
 *
 * The submit form used to compute the expense total by summing its line
 * items, which silently discarded anything the receipt charged without
 * itemising — a card surcharge, freight, a discount, cash rounding. The
 * recorded total then disagreed with the tax invoice and with the bank
 * transfer, so the person who paid was reimbursed short by exactly the
 * surcharge.
 *
 * Simply not computing it would have broken reporting, which aggregates at
 * line level and relies on the lines being a faithful decomposition of the
 * total. So the total is captured and the gap is closed by adding the missing
 * line — see `reconcile`, and `line_item_kind` in 0026.
 *
 * GST IS A PROPERTY OF THE LINE
 *
 * Line GST used to be `line_total / total * gst_amount`: a share of the
 * receipt's GST, apportioned by size. On a receipt mixing GST-free food with
 * a taxable surcharge — most receipts here — that put GST on the fresh meat.
 * Extraction has always read the per-line flag; now it is used.
 */

/** Standard Australian GST. A tax-inclusive amount is 11/10 of its net. */
const GST_DIVISOR = 11;

export type MoneyLine = {
  kind: LineKind;
  /** GST-inclusive amount for this line, as printed. Negative for a discount. */
  lineTotal: number;
  gstApplicable: boolean;
};

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * GST contained within one GST-inclusive line.
 *
 * Returns 0 for a GST-free line rather than a rounded fraction of nothing,
 * which is the whole point of tracking the flag: fresh meat, fruit, plain
 * milk and bread carry no GST, and a claimed credit that does not exist is a
 * worse error on a BAS than a missed one.
 */
export function lineGst(line: MoneyLine): number {
  if (!line.gstApplicable) return 0;
  return round2(line.lineTotal / GST_DIVISOR);
}

export function lineSubtotal(line: MoneyLine): number {
  return round2(line.lineTotal - lineGst(line));
}

export function sumLines(lines: MoneyLine[]): number {
  return round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
}

export function sumLineGst(lines: MoneyLine[]): number {
  return round2(lines.reduce((sum, l) => sum + lineGst(l), 0));
}

/**
 * Tolerance for "the lines account for the total".
 *
 * Not a business allowance. Australian 5c cash rounding prints on the receipt
 * as its own line and is captured as one (kind 'rounding'), so there is
 * nothing legitimate left to absorb. This covers floating-point noise only —
 * a band any wider is how unexplained differences become permanent.
 */
export const RECONCILE_TOLERANCE = 0.01;

export type Reconciliation = {
  lineSum: number;
  /** What the receipt says, which is what will be paid. */
  receiptTotal: number;
  /** receiptTotal - lineSum. Positive means something is not yet on a line. */
  difference: number;
  balanced: boolean;
};

export function reconcile(lines: MoneyLine[], receiptTotal: number): Reconciliation {
  const lineSum = sumLines(lines);
  const difference = round2(receiptTotal - lineSum);
  return {
    lineSum,
    receiptTotal,
    difference,
    balanced: Math.abs(difference) <= RECONCILE_TOLERANCE,
  };
}

/**
 * Whether the per-line GST flags agree with the GST the receipt prints.
 *
 * This check could not exist under apportionment: line GST was *defined* as a
 * share of the receipt's GST, so it always agreed with itself no matter how
 * wrongly it was distributed. Reading the flag per line makes the two figures
 * independent, and therefore capable of disagreeing usefully — a mismatch
 * means a taxable line was missed, or one was flagged that should not be.
 *
 * Returns null when the receipt printed no GST figure to compare against.
 */
export function gstDiscrepancy(lines: MoneyLine[], printedGst: number | null): number | null {
  if (printedGst == null) return null;
  return round2(printedGst - sumLineGst(lines));
}

/**
 * The kind to give a line created to absorb an unexplained difference.
 *
 * A positive difference means the receipt charged more than the lines
 * account for; a negative one means it charged less, which in practice is a
 * discount that was read as a line but not signed.
 */
export function suggestedKindForDifference(difference: number): LineKind {
  return difference < 0 ? "discount" : "surcharge";
}

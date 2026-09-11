// From the leaf module, not receipt-extraction: this file is reached by client
// components, and a value imported from there pulls the Anthropic client and
// the MIME parser into the browser bundle.
import { SUBSTANTIVE_KINDS } from "@/lib/line-kinds";
import type { LineKind, StoredLineKind } from "@/lib/line-kinds";

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
  /**
   * Wider than the enum the model can return, because `unallocated` is a kind
   * the app assigns rather than one a receipt states — see residualFor.
   */
  kind: StoredLineKind;
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
 * Whether a stored expense's line GST disagrees with its printed GST by more
 * than rounding can explain (0048).
 *
 * A receipt usually works GST out once, on its taxable total; the lines each
 * round their own eleventh. That can differ by up to half a cent per taxable
 * line without anything being wrong, so the band grows with the number of
 * taxable lines rather than being a fixed few cents that a long invoice would
 * trip for no reason.
 *
 * Returns the difference (printed minus lines) when it matters, or null.
 */
export function storedGstDisagreement(
  lineGstTotal: number,
  printedGst: number | null,
  taxableLineCount: number
): number | null {
  if (printedGst == null) return null;
  const difference = round2(printedGst - lineGstTotal);
  const tolerance = RECONCILE_TOLERANCE + 0.005 * Math.max(1, taxableLineCount);
  return Math.abs(difference) > tolerance ? difference : null;
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

/**
 * Above this share of the receipt total, a gap stops being a plausible
 * surcharge and starts being missing goods.
 *
 * Australian card surcharges run to about 1.5%, delivery on a grocery order
 * rarely exceeds 10%, and a bulk discount can reach 10-15%. Measured against
 * the real receipt folder, the two gaps that were genuinely charges came in at
 * 0.3% and 3.1%, while the two that were missing line items were 36% and 100%.
 * There is a wide, empty gulf between those, which is what makes a threshold
 * here safe rather than arbitrary.
 */
const CHARGE_PLAUSIBILITY_LIMIT = 0.15;

export type Residual = {
  kind: StoredLineKind;
  amount: number;
  /** Why this line exists, shown to the submitter for confirmation. */
  reason: "charge" | "unitemised";
};

/**
 * What to do with money the line items do not account for.
 *
 * The submitter should not have to tell the app that a 56c gap on a $100
 * grocery receipt was the card surcharge — extraction usually reads it, and
 * when it does not, the arithmetic is unambiguous. So the line gets created
 * automatically and the submitter only has to glance at it.
 *
 * What must not be automated is the case where the gap is large enough that
 * it is probably a line item nobody read. A $1,097 "surcharge" on a $3,021
 * invoice is not a surcharge, it is half the invoice missing, and booking it
 * silently under a charge type would hide exactly the failure a person needs
 * to see. Those become an `unallocated` line instead (see migration 0026),
 * which keeps both invariants true — the total is right, and the lines sum to
 * it — while marking the ambiguity for the review queue rather than burying it.
 *
 * Returns null when the lines already account for the total.
 */
export function residualFor(lines: MoneyLine[], receiptTotal: number): Residual | null {
  const balance = reconcile(lines, receiptTotal);
  if (balance.balanced) return null;

  const share = receiptTotal === 0 ? 1 : Math.abs(balance.difference / receiptTotal);
  // Services count here as much as goods do. A cleaning invoice carries no
  // goods at all, so without this its card surcharge would be booked as "not
  // itemised" and sent to the review queue — a person summoned to confirm a
  // 56c fee on an invoice that is perfectly well understood.
  const hasSubstantive = lines.some((l) =>
    (SUBSTANTIVE_KINDS as readonly string[]).includes(l.kind)
  );

  if (!hasSubstantive || share > CHARGE_PLAUSIBILITY_LIMIT) {
    return { kind: "unallocated", amount: balance.difference, reason: "unitemised" };
  }
  return {
    kind: suggestedKindForDifference(balance.difference),
    amount: balance.difference,
    reason: "charge",
  };
}

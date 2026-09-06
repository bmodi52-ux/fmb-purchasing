/**
 * What a line item is, as plain constants.
 *
 * Deliberately a leaf module with no imports. These values are needed by the
 * submit form, the reconciliation strip and the expense-lines ledger — all
 * client components — and they used to live in receipt-extraction.ts alongside
 * the Anthropic client and the MIME parser. Importing a *type* from there was
 * free, because types are erased; importing a value pulled the whole module
 * graph into the browser bundle, which is 160KB of SDK that no page needs and
 * no user should be made to download.
 *
 * Mirrors the `line_item_kind` enum in migrations 0026 and 0035 — keep them in
 * step.
 */

/** Every kind extraction may return. */
export const LINE_KINDS = [
  "goods",
  "service",
  "surcharge",
  "delivery",
  "discount",
  "rounding",
  "deposit",
] as const;

export type LineKind = (typeof LINE_KINDS)[number];

/**
 * Every kind a stored line can have. `unallocated` is deliberately absent from
 * the enum offered to the model: it is not something a receipt says, it is what
 * the app records when the lines it read do not account for the total and the
 * shortfall is too large to be a charge — see residualFor in expense-money.
 */
export type StoredLineKind = LineKind | "unallocated";

/**
 * Lines that are something the organisation actually bought, as opposed to
 * charges bolted onto the purchase.
 *
 * The distinction decides whether an unexplained gap in a receipt can
 * plausibly be a fee — see residualFor. Services belong here: a cleaning
 * invoice has no goods on it at all, and without them counted its card
 * surcharge would be booked as "not itemised" and sent to the review queue for
 * a person to confirm 56 cents.
 */
export const SUBSTANTIVE_KINDS: readonly LineKind[] = ["goods", "service"];

/**
 * Whether a reading of a receipt looks like it stopped before the last line (#58).
 *
 * A handwritten BLF & MIX invoice of eighteen lines came back with four, and
 * the other $1,467 of its $2,737 became one "Not itemised" line. Read again
 * the same photo gave seventeen lines, then six: the model can read it, it
 * just doesn't always carry on to the bottom. The total is read reliably, so
 * lines falling well short of it is the sign to ask again.
 *
 * Only a shortfall counts. Lines adding to more than the total is a different
 * mistake — a misread figure — that reading more lines would not fix.
 */
export function linesShortfall(receipt: {
  total: number | null;
  lineItems: { lineTotal: number | null }[];
}): number | null {
  if (receipt.total == null || receipt.total <= 0) return null;
  const sum = receipt.lineItems.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
  const short = Math.round((receipt.total - sum) * 100) / 100;
  // A dollar, or two percent of the total, whichever is more: small enough to
  // catch a missing line, large enough to leave rounding and surcharges alone.
  return short > Math.max(1, receipt.total * 0.02) ? short : null;
}

/** Of two readings of the same receipt, the one whose lines come closer to its total. */
export function closerToTotal<R extends { total: number | null; lineItems: { lineTotal: number | null }[] }>(
  first: R,
  second: R
): R {
  const gap = (r: R) =>
    r.total == null ? Infinity : Math.abs(r.total - r.lineItems.reduce((s, l) => s + (l.lineTotal ?? 0), 0));
  return gap(second) < gap(first) ? second : first;
}

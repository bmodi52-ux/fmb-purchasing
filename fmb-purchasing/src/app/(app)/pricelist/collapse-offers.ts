/**
 * Collapsing the Pricelist's vendor offers down to one row per item.
 *
 * Kept out of items-table.tsx so it can be tested directly: the test runner
 * strips TypeScript but does not transform JSX, so a .tsx module cannot be
 * imported from a test.
 */

/** The subset of an offer row this needs; the table's OfferRow satisfies it. */
export type CollapsibleOffer = {
  itemId: string;
  status: string;
  costPerBaseUnit: number | null;
  vendorLabel: string;
};

/**
 * Best offer first: approved before pending before rejected, then cheapest per
 * base unit, then vendor name so the order is stable.
 *
 * Status outranks price on purpose. A rejected offer is not a price anyone can
 * act on, so it must never become the face of an item merely by being cheap.
 */
export function bestOfferFirst<T extends CollapsibleOffer>(a: T, b: T): number {
  const rank = (o: CollapsibleOffer) => (o.status === "approved" ? 0 : o.status === "pending" ? 1 : 2);
  return (
    rank(a) - rank(b) ||
    (a.costPerBaseUnit ?? Infinity) - (b.costPerBaseUnit ?? Infinity) ||
    a.vendorLabel.localeCompare(b.vendorLabel)
  );
}

/**
 * One row per item while the Vendor column is hidden.
 *
 * A row is a vendor offer, so an item stocked by three vendors is three rows.
 * That is the right shape when you can see who each row belongs to, and noise
 * when you cannot: the same item name repeated, differing only in numbers
 * nobody can attribute. Showing the Vendor column is the clearest statement
 * that per-vendor rows are wanted, so it is what switches this off.
 *
 * The surviving row is the item's best offer, and nothing disappears quietly —
 * it carries otherOfferCount so the table can say how many it stands for, and
 * expanding it still lists every offer.
 *
 * Input order is preserved: the caller has already sorted, and re-ordering
 * here would fight whatever the user clicked on a column header.
 */
export function collapseToItems<T extends CollapsibleOffer>(
  rows: T[],
  visibleColumnKeys: Set<string>
): (T & { otherOfferCount?: number })[] {
  if (visibleColumnKeys.has("vendor")) return rows;

  const byItem = new Map<string, T[]>();
  for (const row of rows) {
    const existing = byItem.get(row.itemId);
    if (existing) existing.push(row);
    else byItem.set(row.itemId, [row]);
  }

  return [...byItem.values()].map((offers) => {
    if (offers.length === 1) return offers[0];
    const [best] = [...offers].sort(bestOfferFirst);
    return { ...best, otherOfferCount: offers.length - 1 };
  });
}

/**
 * Rejected offers, dropped from the Pricelist.
 *
 * A rejected offer is a price someone has already decided against. Listing it
 * beside the live ones — as a row of its own, inside an expanded item, or in
 * the "+N more offers" count — is clutter that reads as a real option at a
 * glance. The full item page still shows every offer with its history, which
 * is where a rejection is actually worth seeing.
 *
 * An item whose every offer was rejected keeps them. Filtering those too would
 * take the item off the Pricelist altogether, leaving nothing to click through
 * to and no way to notice it needs attention.
 */
export function withoutRejectedOffers<T extends CollapsibleOffer>(rows: T[]): T[] {
  const itemsWithLiveOffer = new Set(
    rows.filter((r) => r.status !== "rejected").map((r) => r.itemId)
  );
  return rows.filter((r) => r.status !== "rejected" || !itemsWithLiveOffer.has(r.itemId));
}

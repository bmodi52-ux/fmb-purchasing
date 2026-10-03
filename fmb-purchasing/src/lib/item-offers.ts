/**
 * The figures behind an item's Vendor offers table: what each offer has
 * actually been bought for, beside the price on file, and which of them is
 * the one to buy.
 *
 * An offer's price is what somebody typed or a receipt set; what was paid is
 * what the receipts say. Shown side by side, a price list that has drifted
 * from the till shows up on the row it belongs to.
 */

export type OfferPurchase = {
  offerId: string;
  lineTotal: number;
  /** Packs bought on the line. */
  quantity: number;
  receiptDate: string | null;
  submittedAt: string;
};

export type OfferPurchaseSummary = {
  purchaseCount: number;
  /** Price per pack on the most recent receipt, to the cent. */
  lastPaid: number;
  lastPaidOn: string | null;
};

export function summariseOfferPurchases(purchases: OfferPurchase[]): Map<string, OfferPurchaseSummary> {
  const byOffer = new Map<string, OfferPurchase[]>();
  for (const p of purchases) {
    if (!(p.quantity > 0) || !Number.isFinite(p.lineTotal)) continue;
    byOffer.set(p.offerId, [...(byOffer.get(p.offerId) ?? []), p]);
  }

  const summaries = new Map<string, OfferPurchaseSummary>();
  for (const [offerId, list] of byOffer) {
    // Latest by receipt date, then by when it was submitted — the order
    // summarisePackPrices takes its latest in, so an offer's row and its
    // pack's agree.
    const latest = [...list].sort(
      (a, b) =>
        (b.receiptDate ?? "").localeCompare(a.receiptDate ?? "") || b.submittedAt.localeCompare(a.submittedAt)
    )[0]!;
    summaries.set(offerId, {
      purchaseCount: list.length,
      lastPaid: Math.round((latest.lineTotal / latest.quantity) * 100) / 100,
      lastPaidOn: latest.receiptDate,
    });
  }
  return summaries;
}

/** A percent either way is noise; beyond it, somebody should know the list has drifted. */
const DRIFT_WORTH_SAYING = 0.01;

/**
 * How far the last price paid is from the price on file, as a fraction of the
 * price on file: 0.11 is 11% above it. Null when there is nothing to compare,
 * or the two are within a percent of each other.
 */
export function priceDrift(lastPaid: number | null, packPrice: number | null): number | null {
  if (lastPaid == null || !packPrice || packPrice <= 0) return null;
  const drift = (lastPaid - packPrice) / packPrice;
  return Math.abs(drift) >= DRIFT_WORTH_SAYING ? drift : null;
}

/**
 * The approved offer that costs least per unit. Null when fewer than two can
 * be compared: "cheapest" on an item's only price says nothing.
 */
export function cheapestOfferId(
  offers: { id: string; status: string; costPerUnit: number | null }[]
): string | null {
  const priced = offers.filter((o) => o.status === "approved" && o.costPerUnit != null && o.costPerUnit > 0);
  if (priced.length < 2) return null;
  return priced.reduce((best, o) => (o.costPerUnit! < best.costPerUnit! ? o : best)).id;
}

export type OfferSortKey = "vendor" | "brand" | "pack" | "price" | "perUnit" | "lastPaid" | "bought";
export type OfferSort = { key: OfferSortKey; direction: "asc" | "desc" };

export type SortableOffer = {
  vendorName: string | null;
  brand: string | null;
  /** How much the whole pack holds, so 1 kg sorts before 5 kg. */
  packQuantity: number;
  packPrice: number | null;
  costPerUnit: number | null;
  lastPaid: number | null;
  purchaseCount: number;
};

/** Cheapest per unit first: the question the table is there to answer. */
export const DEFAULT_OFFER_SORT: OfferSort = { key: "perUnit", direction: "asc" };

function sortValue(o: SortableOffer, key: OfferSortKey): string | number | null {
  switch (key) {
    case "vendor":
      return o.vendorName;
    case "brand":
      return o.brand;
    case "pack":
      return o.packQuantity;
    case "price":
      return o.packPrice;
    case "perUnit":
      return o.costPerUnit;
    case "lastPaid":
      return o.lastPaid;
    case "bought":
      return o.purchaseCount;
  }
}

/**
 * A copy of the offers in the order asked for. An offer with nothing in the
 * sorted column goes last in either direction — a missing price is not the
 * lowest one.
 */
export function sortOffers<T extends SortableOffer>(offers: T[], sort: OfferSort): T[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...offers].sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    const xBlank = x == null || x === "";
    const yBlank = y == null || y === "";
    if (xBlank || yBlank) return xBlank === yBlank ? 0 : xBlank ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" }) * sign;
  });
}

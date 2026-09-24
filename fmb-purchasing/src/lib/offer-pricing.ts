/**
 * An offer's prices: the regular one, a special beside it, and GST (#29).
 *
 * Decided 2026-09-24:
 * - Both prices are kept, with the special's last day. The buying list uses
 *   the special up to and including that day and the regular price after it,
 *   so nobody goes back to change anything. Costing always uses the regular
 *   price — a one-week special isn't what a thaali costs.
 * - GST is never assumed. The person says whether a price includes it,
 *   excludes it (10% is then added) or the item has none; every price is
 *   stored including GST, like receipts.
 * - A special whose end the page doesn't give ends on the next Tuesday at
 *   Woolworths and Coles (their specials run Wednesday to Tuesday) and after
 *   7 days anywhere else, marked as assumed.
 */

export type GstAnswer = "included" | "excluded" | "free";
export type GstBasis = "included" | "added" | "free";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function settlePrices({
  price,
  regularPrice,
  gst,
}: {
  /** What the product costs now — the special price when there is one. */
  price: number | null;
  /** Its usual price when `price` is a special. */
  regularPrice: number | null;
  gst: GstAnswer;
}): { packPrice: number | null; salePrice: number | null; gstBasis: GstBasis } {
  const withGst = (n: number | null) => (n == null ? null : gst === "excluded" ? round2(n * 1.1) : n);
  const onSpecial = price != null && regularPrice != null && regularPrice > price;
  return {
    packPrice: withGst(onSpecial ? regularPrice : price),
    salePrice: onSpecial ? withGst(price) : null,
    gstBasis: gst === "excluded" ? "added" : gst,
  };
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TUESDAY_SHOPS = /woolworths|coles/i;

/** When a special ends, if the page didn't say: the shop's own week, else a week. */
export function saleEndFor(shop: string, today: string): string {
  if (TUESDAY_SHOPS.test(shop)) {
    const day = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday … 2 Tuesday
    return addDays(today, (2 - day + 7) % 7);
  }
  return addDays(today, 7);
}

/** What an offer costs on a given day: the special while it runs, else the regular price. */
export function priceOn(
  offer: { packPrice: number | null; salePrice: number | null; saleEndsOn: string | null },
  date: string
): { price: number | null; onSpecial: boolean } {
  if (offer.salePrice != null && offer.saleEndsOn != null && date <= offer.saleEndsOn) {
    return { price: offer.salePrice, onSpecial: true };
  }
  return { price: offer.packPrice, onSpecial: false };
}

/**
 * What each pack has actually cost, per pack — per box, per bag.
 *
 * item_unit_costs answers what the item costs per kilo, which is the figure
 * that compares a 6 kg box with a 10 kg one. But a box of chilli is bought for
 * $40 a box, and that is the number on the invoice and the number anyone
 * remembers, so it is shown beside the per-kilo figure rather than instead.
 *
 * The same purchases item_paid_unit_costs reads, divided differently: the
 * line's total over the number of packs bought, where that view goes on to
 * divide through what each pack holds.
 */
export type PackPurchase = {
  packSizeId: string;
  lineTotal: number;
  /** Packs bought on the line. */
  quantity: number;
  receiptDate: string | null;
  submittedAt: string;
};

export type PackPriceSummary = {
  purchaseCount: number;
  /** Price per pack on the most recent receipt. */
  latest: number;
  average: number;
};

export function summarisePackPrices(purchases: PackPurchase[]): Map<string, PackPriceSummary> {
  const byPack = new Map<string, PackPurchase[]>();
  for (const p of purchases) {
    if (!(p.quantity > 0) || !Number.isFinite(p.lineTotal)) continue;
    byPack.set(p.packSizeId, [...(byPack.get(p.packSizeId) ?? []), p]);
  }

  const summaries = new Map<string, PackPriceSummary>();
  for (const [packSizeId, list] of byPack) {
    // Latest by receipt date, then by when it was submitted — the order
    // item_unit_costs takes its latest figure in, so the two agree.
    const ordered = [...list].sort(
      (a, b) =>
        (b.receiptDate ?? "").localeCompare(a.receiptDate ?? "") || b.submittedAt.localeCompare(a.submittedAt)
    );
    const prices = ordered.map((p) => p.lineTotal / p.quantity);
    summaries.set(packSizeId, {
      purchaseCount: prices.length,
      latest: round4(prices[0]!),
      average: round4(prices.reduce((sum, n) => sum + n, 0) / prices.length),
    });
  }
  return summaries;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

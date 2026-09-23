import { round2 } from "@/lib/expense-money";

/**
 * The monthly count of high-value stock (#10): what is on the shelf, what it
 * is worth, and how it moved since the last count. Pure arithmetic.
 */

export type StockCount = {
  countedOn: string;
  itemId: string;
  quantity: number;
  /** The unit it was counted in, and what one of it is in the item's base unit. */
  unitCode: string;
  toBase: number;
};

/** In the item's base unit, so counts made in different units compare. */
export function inBase(count: Pick<StockCount, "quantity" | "toBase">): number {
  return count.quantity * count.toBase;
}

/** What a count is worth at a price per base unit; null without a price. */
export function valueOf(count: Pick<StockCount, "quantity" | "toBase">, perBaseUnit: number | null): number | null {
  return perBaseUnit == null ? null : round2(inBase(count) * perBaseUnit);
}

/** The most recent count dates, newest first, for the columns of a history. */
export function recentDates(counts: readonly StockCount[], limit = 6): string[] {
  return [...new Set(counts.map((c) => c.countedOn))].sort().reverse().slice(0, limit);
}

/**
 * How an item moved from its previous count to its latest, in base units.
 * Null until it has been counted twice.
 */
export function changeSinceLast(counts: readonly StockCount[], itemId: string): number | null {
  const mine = counts.filter((c) => c.itemId === itemId).sort((a, b) => b.countedOn.localeCompare(a.countedOn));
  if (mine.length < 2) return null;
  return Math.round((inBase(mine[0]) - inBase(mine[1])) * 1000) / 1000;
}

/** Everything counted on one date, valued at today's prices. */
export function totalValue(
  counts: readonly StockCount[],
  date: string,
  priceOf: (itemId: string) => number | null
): { value: number; unpriced: number } {
  let value = 0;
  let unpriced = 0;
  for (const c of counts.filter((x) => x.countedOn === date)) {
    const v = valueOf(c, priceOf(c.itemId));
    if (v == null) unpriced += 1;
    else value += v;
  }
  return { value: round2(value), unpriced };
}

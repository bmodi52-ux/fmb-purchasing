/**
 * How old a price is (#30). Prices never expire (decided 2026-09-24): an old
 * price still counts, because dropping it would leave rarely bought items
 * with no price at all. Instead its age is shown beside it, highlighted once
 * it is past OLD_PRICE_DAYS, and the oldest are listed on Needs attention.
 */

export const OLD_PRICE_DAYS = 60;

/** Whole days from a YYYY-MM-DD date to today (YYYY-MM-DD); null for no date. */
export function priceAgeDays(date: string | null | undefined, today: string): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const from = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  const to = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function isOldPrice(date: string | null | undefined, today: string): boolean {
  const days = priceAgeDays(date, today);
  return days != null && days > OLD_PRICE_DAYS;
}

/** "75 days old", "4 months old", "over a year old". */
export function describePriceAge(days: number): string {
  if (days < 90) return `${days} day${days === 1 ? "" : "s"} old`;
  if (days < 365) return `${Math.floor(days / 30)} months old`;
  return "over a year old";
}

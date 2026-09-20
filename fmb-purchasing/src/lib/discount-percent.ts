import { round2, type MoneyLine } from "@/lib/expense-money";
import { SUBSTANTIVE_KINDS } from "@/lib/line-kinds";

/**
 * A discount entered as a percentage (#62).
 *
 * Suppliers here write "10 % DISCOUNT" and then the amount, so the percentage
 * is what the person reads off the receipt and the amount is arithmetic they
 * should not have to do. The amount is still what gets stored — the
 * percentage is only how it was arrived at — so a supplier who rounds
 * differently can be matched by editing the amount afterwards.
 *
 * Taken off what was bought: goods and services, before charges. A card
 * surcharge is charged on the discounted amount, not discounted itself, and
 * discounting a discount is meaningless.
 */
export function discountBase(lines: MoneyLine[]): number {
  return round2(
    lines
      .filter((l) => (SUBSTANTIVE_KINDS as readonly string[]).includes(l.kind))
      .reduce((sum, l) => sum + l.lineTotal, 0)
  );
}

/** What a percentage off comes to, as a negative line total. Null when it can't be worked out. */
export function discountAmount(lines: MoneyLine[], percent: number | null): number | null {
  if (percent == null || !Number.isFinite(percent) || percent <= 0) return null;
  const base = discountBase(lines);
  if (base <= 0) return null;
  return -round2((base * percent) / 100);
}

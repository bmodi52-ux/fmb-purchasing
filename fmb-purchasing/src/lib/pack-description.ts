import { canonicalUnitCode } from "@/lib/units";

/**
 * A pack size in words somebody who has never seen the Pricelist can follow.
 *
 * Packs used to be written the way they are stored — "1 ea × 2 (2 ea)" for a
 * bag of two roti — which is exact and unreadable. "ea" is a code, the "1" is a
 * detail nobody asked about, and the bracketed total repeats the sum. The
 * people picking an item on the submit page are the ones least able to decode
 * it, and a wrong pick files the purchase against the wrong pack.
 *
 * Every place a pack is shown goes through here, so the Pricelist, the item
 * page, the review queue and the submit typeahead can never describe the same
 * pack two different ways.
 */
export type PackDescriptionInput = {
  /** How much is in one of the things in the pack — the 5 in "4 × 5 kg". */
  innerQuantity: number | string;
  /** The unit's label as stored ("ea", "kg", "Carton"). */
  unitLabel: string | null | undefined;
  /** How many of those make up the pack — the 4 in "4 × 5 kg". */
  packCount: number | string;
  soldLoose?: boolean | null;
};

/** Numbers as a person writes them: 5, 2.5, 0.75 — never 5.000. */
function amount(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function isCountOfItems(unitLabel: string | null | undefined): boolean {
  return canonicalUnitCode(unitLabel) === "ea";
}

/**
 * What one of a unit is called in a sentence. "ea" becomes "item", because
 * nobody outside a stock system says "2 ea"; a carton pluralises; weights and
 * volumes keep their symbol, which reads the same for one or many.
 */
export function unitName(unitLabel: string | null | undefined, quantity = 1): string {
  const code = canonicalUnitCode(unitLabel);
  const plural = quantity !== 1;
  if (code === "ea") return plural ? "items" : "item";
  if (code === "carton") return plural ? "cartons" : "carton";
  return unitLabel ?? "";
}

/** A unit as it reads in a picker: "item" rather than "ea". */
export function unitOptionLabel(label: string): string {
  return unitName(label) || label;
}

function measure(quantity: number, unitLabel: string | null | undefined): string {
  return `${amount(quantity)} ${unitName(unitLabel, quantity)}`.trim();
}

/**
 * The pack's shape in plain words:
 *
 *   one roti                    Single item
 *   a bag of 2 roti             Pack of 2
 *   a tray of 30 eggs           Pack of 30
 *   10 trays of 30              10 packs of 30, 300 items
 *   a 5 kg bag                  5 kg
 *   4 bags of 5 kg              4 × 5 kg, 20 kg in total
 *   bought by weight            Loose, priced per kg
 */
export function describePack(p: PackDescriptionInput): string {
  const inner = Number(p.innerQuantity);
  const count = Number(p.packCount);

  if (p.soldLoose && count === 1 && inner === 1) {
    return `Loose, priced per ${unitName(p.unitLabel)}`.trim();
  }

  if (isCountOfItems(p.unitLabel)) {
    if (count === 1 && inner === 1) return "Single item";
    if (count === 1) return `Pack of ${amount(inner)}`;
    if (inner === 1) return `Pack of ${amount(count)}`;
    return `${amount(count)} packs of ${amount(inner)}, ${amount(count * inner)} items`;
  }

  if (count === 1) return measure(inner, p.unitLabel);
  return `${amount(count)} × ${measure(inner, p.unitLabel)}, ${measure(count * inner, p.unitLabel)} in total`;
}

/**
 * The pack's name when somebody gave it one, with its shape alongside so the
 * name can't mislead: "Carton (4 × 5 kg, 20 kg in total)". A name that only
 * restates the shape is not repeated.
 */
export function packTitle(label: string | null | undefined, p: PackDescriptionInput): string {
  const shape = describePack(p);
  const name = label?.trim();
  if (!name) return shape;
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return squash(name) === squash(shape) ? name : `${name} (${shape})`;
}

/**
 * A cost per unit: "$0.2500 each" for items, "$2.4000/kg" for anything
 * measured. "$0.25/ea" was the same figure in stock-system shorthand.
 */
export function formatUnitCost(
  cost: number,
  unitLabel: string | null | undefined,
  { decimals = 4, currency = true }: { decimals?: number; currency?: boolean } = {}
): string {
  const figure = `${currency ? "$" : ""}${cost.toFixed(decimals)}`;
  if (isCountOfItems(unitLabel)) return `${figure} each`;
  return unitLabel ? `${figure}/${unitLabel}` : figure;
}

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
  /** What the pack comes in — "box". Null for a pack nobody has described. */
  packaging?: string | null;
};

/**
 * What a pack can come in, mirroring the item_pack_sizes_packaging_check
 * constraint in migration 0040. Here rather than beside the server action for
 * the same reason as UNIT_DIMENSIONS: the client form needs it too.
 */
export const PACKAGING = [
  "box",
  "bag",
  "sack",
  "carton",
  "tray",
  "punnet",
  "bunch",
  "bottle",
  "jar",
  "tin",
  "tub",
  "pack",
] as const;

export type Packaging = (typeof PACKAGING)[number];

/** How a pack form describes a pack: loose, in some packaging, or not yet said. */
export type SoldAs = Packaging | "loose" | "";

export function isPackaging(value: unknown): value is Packaging {
  return typeof value === "string" && (PACKAGING as readonly string[]).includes(value);
}

/** "Box", for a picker or the start of a sentence. */
export function packagingLabel(packaging: string): string {
  return packaging.charAt(0).toUpperCase() + packaging.slice(1);
}

/** What one pack is called in a price: "per box", or "per pack" when unsaid. */
export function packagingWord(packaging: string | null | undefined): string {
  return isPackaging(packaging) ? packaging : "pack";
}

/**
 * Outer packaging first: "a carton of 10 bottles" is a carton. The same words
 * in the same order as the backfill in migration 0040.
 */
const PACKAGING_WORDS: [Packaging, RegExp][] = [
  ["carton", /\b(cartons?|ctns?|cases?)\b/i],
  ["box", /\b(box|boxes)\b/i],
  ["sack", /\bsacks?\b/i],
  ["bag", /\bbags?\b/i],
  ["tray", /\btrays?\b/i],
  ["punnet", /\bpunnets?\b/i],
  ["bunch", /\b(bunch|bunches)\b/i],
  ["tub", /\btubs?\b/i],
  ["jar", /\bjars?\b/i],
  ["tin", /\b(tins?|cans?)\b/i],
  ["bottle", /\b(bottles?|btls?)\b/i],
  ["pack", /\b(packs?|packets?|pkts?|pk)\b/i],
];

/** The packaging a line of text names — "Green Chilli 6kg Box" is a box. */
export function packagingFromText(text: string | null | undefined): Packaging | null {
  if (!text) return null;
  for (const [packaging, pattern] of PACKAGING_WORDS) {
    if (pattern.test(text)) return packaging;
  }
  return null;
}

/** How a stored pack reads back into the pack form. */
export function soldAsOf(p: PackDescriptionInput): SoldAs {
  if (isLoose(p)) return "loose";
  return isPackaging(p.packaging) ? p.packaging : "";
}

/** Numbers as a person writes them: 5, 2.5, 0.75 — never 5.000. */
function amount(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function isCountOfItems(unitLabel: string | null | undefined): boolean {
  return canonicalUnitCode(unitLabel) === "ea";
}

/** Loose only means something for one unit — a stated pack is still a pack. */
function isLoose(p: PackDescriptionInput): boolean {
  return Boolean(p.soldLoose) && Number(p.packCount) === 1 && Number(p.innerQuantity) === 1;
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
 *   a 6 kg box of chilli        Box of 6 kg
 *   a carton of ten 1 L bottles Carton of 10 × 1 L, 10 L in total
 *   a tray of 30 eggs           Tray of 30
 *   bought by weight            Loose, priced per kg
 *
 * and, for a pack nobody has said the packaging of:
 *
 *   one roti                    Single item
 *   a bag of 2 roti             Pack of 2
 *   10 trays of 30              10 packs of 30, 300 items
 *   a 5 kg bag                  5 kg
 *   4 bags of 5 kg              4 × 5 kg, 20 kg in total
 */
export function describePack(p: PackDescriptionInput): string {
  const inner = Number(p.innerQuantity);
  const count = Number(p.packCount);
  const total = count * inner;
  const container = isPackaging(p.packaging) ? packagingLabel(p.packaging) : null;

  if (isLoose(p)) {
    return `Loose, priced per ${unitName(p.unitLabel)}`.trim();
  }

  if (isCountOfItems(p.unitLabel)) {
    if (container) {
      if (count === 1 || inner === 1) return total === 1 ? `1 ${p.packaging}` : `${container} of ${amount(total)}`;
      return `${container} of ${amount(count)} × ${amount(inner)}, ${amount(total)} items`;
    }
    if (count === 1 && inner === 1) return "Single item";
    if (count === 1) return `Pack of ${amount(inner)}`;
    if (inner === 1) return `Pack of ${amount(count)}`;
    return `${amount(count)} packs of ${amount(inner)}, ${amount(total)} items`;
  }

  const contents =
    count === 1
      ? measure(inner, p.unitLabel)
      : `${amount(count)} × ${measure(inner, p.unitLabel)}, ${measure(total, p.unitLabel)} in total`;
  return container ? `${container} of ${contents}` : contents;
}

const FILLER_WORDS = new Set(["of", "x", "in", "total", "a", "an", "the"]);

/** The words that carry meaning, so "6 kg box" and "Box of 6 kg" compare equal. */
function meaningfulWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) ?? [];
  return new Set(
    words
      .filter((w) => !FILLER_WORDS.has(w))
      .map((w) => {
        const unit = canonicalUnitCode(w);
        if (unit) return unit.toLowerCase();
        if (/(x|ch|sh)es$/.test(w)) return w.slice(0, -2);
        if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
        return w;
      })
  );
}

/**
 * The pack's name when somebody gave it one, with its shape alongside so the
 * name can't mislead: "Large box (Box of 6 kg)".
 *
 * Only one of the two when one already says everything the other does. "6 kg
 * box" beside "Box of 6 kg" is the same words twice, and "6 kg box (6 kg)"
 * was a heading that repeated itself.
 */
export function packTitle(label: string | null | undefined, p: PackDescriptionInput): string {
  const shape = describePack(p);
  const name = label?.trim();
  if (!name) return shape;

  const nameWords = meaningfulWords(name);
  const shapeWords = meaningfulWords(shape);
  if ([...nameWords].every((w) => shapeWords.has(w))) return shape;
  if ([...shapeWords].every((w) => nameWords.has(w))) return name;
  return `${name} (${shape})`;
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

/**
 * A pack's price as whoever pays it thinks of it: "$40.00 per box". A loose
 * pack's price is already the price of one unit, so it reads "$7.00/kg".
 */
export function formatPackPrice(price: number, p: PackDescriptionInput): string {
  if (isLoose(p)) return formatUnitCost(price, p.unitLabel, { decimals: 2 });
  return `$${price.toFixed(2)} per ${packagingWord(p.packaging)}`;
}

/** The label on the price field of an offer for this pack: "Price per box". */
export function priceFieldLabel(p: PackDescriptionInput): string {
  if (isLoose(p)) return `Price per ${unitName(p.unitLabel) || "unit"}`;
  return `Price per ${packagingWord(p.packaging)}`;
}

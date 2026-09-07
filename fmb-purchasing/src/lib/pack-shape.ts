import { canonicalUnitCode } from "@/lib/units";

/**
 * The pack a receipt line describes, read out of its own wording.
 *
 * Setting up a new item was the slowest thing in the app: a receipt created
 * the item, but its pack size was always the plain "one unit" shape, so
 * somebody had to open the item page and describe the pack by hand before any
 * per-unit cost meant anything — every time, for every new item.
 *
 * The quantity bought deliberately cannot be used for this. "80 kg purchased"
 * is not an 80 kg pack, and reading it as one is what produced nonsense pack
 * sizes before matchOrCreatePackSize was cut back to "one unit". The
 * *description* is different evidence entirely: "Rice 5kg x 4" is the vendor
 * stating how the product is packaged, on the line itself.
 *
 * Deliberately narrow. It reads the shapes that appear on real invoices and
 * returns null for everything else, because a wrong pack size is worse than no
 * pack size — it silently divides every cost comparison by the wrong number,
 * where a missing one merely leaves the work undone.
 */
export type PackShape = {
  /** How much is in one inner unit — the 5 in "5kg x 4". */
  innerQuantity: number;
  /** Canonical unit code for that quantity, e.g. "kg". */
  unitCode: string;
  /** How many of those in a pack — the 4 in "5kg x 4". One when unstated. */
  packCount: number;
};

/** The units worth reading out of a description, longest spelling first. */
const UNIT_PATTERN =
  "kilograms|kilogram|kilos|kilo|kgs|kg|grams|gram|gms|gm|g|" +
  "millilitres|milliliters|millilitre|milliliter|mls|ml|" +
  "litres|liters|litre|liter|ltrs|ltr|lt|l";

/**
 * A whole number that is genuinely whole — not the half of a decimal that
 * happens to sit beside the multiplication sign. Without the guards, "5kg x
 * 2.5" reads as a pack of two.
 */
const WHOLE = String.raw`(?<![\d.])(\d+)(?![\d.])`;

/** "5kg x 4", "5 kg × 4", "5kg*4" — the quantity first, then the count. */
const QUANTITY_THEN_COUNT = new RegExp(
  String.raw`(\d+(?:\.\d+)?)\s*(${UNIT_PATTERN})\b\s*[x×*]\s*${WHOLE}`,
  "i"
);

/** "4 x 5kg", "4x5 kg", "10 × 1L" — the count first, then the quantity. */
const COUNT_THEN_QUANTITY = new RegExp(
  String.raw`${WHOLE}\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(${UNIT_PATTERN})\b`,
  "i"
);

/** "5kg", "500 g", "1.5L" on its own. */
const QUANTITY_ONLY = new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(${UNIT_PATTERN})\b`, "i");

/**
 * How large a stated pack can be before it is more likely a misreading.
 *
 * A carton of 144 is real; a "pack" of 5,000 is a quantity, a product code or
 * a year that happened to sit next to an x.
 */
const MAX_PACK_COUNT = 500;

/** Above this, the number is a total bought rather than a unit's contents. */
const MAX_INNER_QUANTITY = 1000;

function shape(quantity: string, unit: string, count: string | null): PackShape | null {
  const innerQuantity = Number(quantity);
  const packCount = count === null ? 1 : Number(count);
  const unitCode = canonicalUnitCode(unit);

  if (!unitCode) return null;
  if (!(innerQuantity > 0) || innerQuantity > MAX_INNER_QUANTITY) return null;
  if (!Number.isInteger(packCount) || packCount < 1 || packCount > MAX_PACK_COUNT) return null;

  return { innerQuantity, unitCode, packCount };
}

/**
 * Read a pack shape out of a line's description, or null when it does not
 * plainly state one.
 *
 * Only mass and volume are read. A count ("12 pcs") says nothing about what
 * one of them holds — twelve eggs or twelve trays of thirty — which is exactly
 * the ambiguity that has to stay in front of a person.
 */
export function packShapeFromDescription(description: string | null | undefined): PackShape | null {
  const text = (description ?? "").trim();
  if (!text) return null;

  const both = QUANTITY_THEN_COUNT.exec(text);
  if (both) return shape(both[1]!, both[2]!, both[3]!);

  const reversed = COUNT_THEN_QUANTITY.exec(text);
  if (reversed) return shape(reversed[2]!, reversed[3]!, reversed[1]!);

  const single = QUANTITY_ONLY.exec(text);
  if (single) return shape(single[1]!, single[2]!, null);

  return null;
}

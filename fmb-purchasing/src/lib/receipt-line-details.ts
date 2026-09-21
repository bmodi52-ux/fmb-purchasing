import { canonicalUnitCode } from "@/lib/units";
import { isPackaging, type Packaging } from "@/lib/pack-description";
import type { PackShape } from "@/lib/pack-shape";

/**
 * What a receipt line says about the product itself, beyond what was paid
 * (#79): the brand, the vendor's own product code, what it comes in, and the
 * pack it was sold in.
 *
 * All of it used to be left for a person to type in on the Pricelist after
 * the fact, although the invoice had printed most of it. Read at extraction,
 * carried on the line through the submit form, and written onto the pending
 * offer and its pack — where it waits, like everything a receipt creates, for
 * somebody to check it and approve.
 *
 * A leaf module with no server imports, because the submit form carries these
 * on its lines.
 */
export type ReceiptLineDetails = {
  brand: string | null;
  /** The vendor's product code as printed — what goes in vendor_sku. */
  productCode: string | null;
  /** What one unit bought comes in, or "loose"; null when the line doesn't say. */
  packaging: Packaging | "loose" | null;
  /** How much one of the things in the pack holds — the 500 in "500 g". */
  packInnerQuantity: number | null;
  /** The unit that is in, as a unit code: "kg", "g", "L", "mL", "ea". */
  packUnit: string | null;
  /** How many of those are sold together — the 10 in "10 × 1 L". */
  packCount: number | null;
};

/** Same bounds as packShapeFromDescription, so neither path invents a pack the other would refuse. */
const MAX_PACK_COUNT = 500;
const MAX_INNER_QUANTITY = 1000;

function text(value: unknown, max = 80): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, max) : null;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The details a model returned, cleaned up — or null when it returned
 * nothing worth keeping. Anything malformed is dropped rather than guessed at.
 */
export function lineDetailsFrom(raw: {
  brand?: unknown;
  productCode?: unknown;
  packaging?: unknown;
  packSize?: { innerQuantity?: unknown; unit?: unknown; packCount?: unknown } | null;
}): ReceiptLineDetails | null {
  const unit = canonicalUnitCode(typeof raw.packSize?.unit === "string" ? raw.packSize.unit : null);
  const inner = positive(raw.packSize?.innerQuantity);
  const count = positive(raw.packSize?.packCount) ?? (inner != null ? 1 : null);
  const packOk =
    unit != null &&
    unit !== "carton" &&
    inner != null &&
    inner <= MAX_INNER_QUANTITY &&
    count != null &&
    Number.isInteger(count) &&
    count <= MAX_PACK_COUNT;

  const details: ReceiptLineDetails = {
    brand: text(raw.brand),
    productCode: text(raw.productCode, 40),
    packaging: raw.packaging === "loose" || isPackaging(raw.packaging) ? raw.packaging : null,
    packInnerQuantity: packOk ? inner : null,
    packUnit: packOk ? unit : null,
    packCount: packOk ? count : null,
  };
  return Object.values(details).some((v) => v != null) ? details : null;
}

/** The pack a line's details state, in the shape the matching code works in. */
export function packShapeFromDetails(details: ReceiptLineDetails | null | undefined): PackShape | null {
  if (!details || details.packInnerQuantity == null || !details.packUnit || details.packCount == null) return null;
  // Loose goods are one unit, whatever the line printed beside them.
  if (details.packaging === "loose") return { innerQuantity: 1, unitCode: details.packUnit, packCount: 1 };
  return { innerQuantity: details.packInnerQuantity, unitCode: details.packUnit, packCount: details.packCount };
}

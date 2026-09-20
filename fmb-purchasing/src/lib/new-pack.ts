import type { PackFieldValues } from "@/app/(app)/pricelist/pack-fields";

export type PackUnitOption = { id: string; code: string; label: string };

/** A described pack, in the shape the server takes — null while it is unusable. */
export function packFromFields(
  fields: PackFieldValues | null | undefined
): { soldAs: string; innerQuantity: number; innerUnitId: string; packCount: number } | null {
  if (!fields) return null;
  const loose = fields.soldAs === "loose";
  const innerQuantity = loose ? 1 : Number(fields.innerQuantity);
  const packCount = loose ? 1 : Number(fields.packCount || "1");
  if (!fields.innerUnitId || !Number.isFinite(innerQuantity) || innerQuantity <= 0) return null;
  if (!Number.isFinite(packCount) || packCount <= 0) return null;
  return { soldAs: fields.soldAs, innerQuantity, innerUnitId: fields.innerUnitId, packCount };
}

/**
 * What to open the pack fields on for a line (#60).
 *
 * The line usually says it already: eight cases coming to 24 kg is 3 kg a
 * case. Filling that in means the usual answer is to glance at it and carry
 * on, rather than work it out with the invoice in hand.
 */
export function packDefaultsForLine(
  line: { quantity: number | null; normalizedQuantity: number | null; normalizedUnit: string | null },
  units: PackUnitOption[]
): PackFieldValues {
  const each =
    line.normalizedQuantity && line.quantity && line.quantity > 0
      ? Math.round((line.normalizedQuantity / line.quantity) * 1000) / 1000
      : null;
  const unit = line.normalizedUnit ? units.find((u) => u.code === line.normalizedUnit) : undefined;
  return {
    soldAs: "",
    innerQuantity: each && each > 0 ? String(each) : "1",
    innerUnitId: unit?.id ?? "",
    packCount: "1",
  };
}

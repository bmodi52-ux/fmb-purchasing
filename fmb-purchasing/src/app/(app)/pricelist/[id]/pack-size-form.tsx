import { SubmitButton } from "@/components/submit-button";
import { updatePackSize } from "../actions";
import { PackFields } from "../pack-fields";

type Unit = { id: string; code: string; label: string };

/**
 * Edit form for one pack size. Saving it counts as confirming the contents —
 * the number entered here is what per-unit costs get divided by, so a human
 * having just typed it is exactly the assurance the costing needs.
 */
export function PackSizeForm({
  itemId,
  packSizeId,
  innerQuantity,
  innerUnitId,
  packCount,
  label,
  soldLoose,
  units,
  purchaseCount,
}: {
  itemId: string;
  packSizeId: string;
  innerQuantity: number;
  innerUnitId: string;
  packCount: number;
  label: string | null;
  soldLoose: boolean;
  units: Unit[];
  /** How many recorded purchases would have their per-unit cost restated. */
  purchaseCount: number;
}) {
  return (
    <form action={updatePackSize} className="flex flex-col gap-3">
      <input type="hidden" name="pack_size_id" value={packSizeId} />
      <input type="hidden" name="item_id" value={itemId} />

      <PackFields
        units={units}
        defaults={{ innerQuantity: String(innerQuantity), innerUnitId, packCount: String(packCount) }}
        defaultLabel={label}
        defaultSoldLoose={soldLoose}
      />

      {purchaseCount > 0 && (
        <p className="rounded-md bg-gold/10 px-3 py-2 text-xs text-ink/70">
          {purchaseCount === 1 ? "1 recorded purchase uses" : `${purchaseCount} recorded purchases use`} this pack
          size, so saving will recalculate {purchaseCount === 1 ? "its" : "their"} cost per unit. The expenses
          themselves aren&apos;t changed.
        </p>
      )}

      <SubmitButton className="self-start rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30">
        Save pack size
      </SubmitButton>
    </form>
  );
}

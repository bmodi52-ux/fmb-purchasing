"use client";

import { useTransition } from "react";
import { SubmitButton } from "@/components/submit-button";
import { useReportPending } from "@/components/pending";
import { soldAsOf } from "@/lib/pack-description";
import { removePackSize, updatePackSize } from "../actions";
import { PackFields } from "../pack-fields";
import { FormResetBoundary } from "@/components/form-reset-boundary";

type Unit = { id: string; code: string; label: string };

/**
 * Edit form for one pack size. Saving it counts as confirming the contents —
 * the number entered here is what per-unit costs get divided by, so a human
 * having just typed it is exactly the assurance the costing needs.
 *
 * Laid out as the offer's form is: the fields in a row, then one line with
 * Save and Cancel, what saving will do, and the way to remove the pack.
 */
export function PackSizeForm({
  itemId,
  packSizeId,
  innerQuantity,
  innerUnitId,
  packCount,
  label,
  soldLoose,
  packaging,
  units,
  purchaseCount,
  canRemove,
  onSaved,
  onCancel,
}: {
  itemId: string;
  packSizeId: string;
  innerQuantity: number;
  innerUnitId: string;
  packCount: number;
  label: string | null;
  soldLoose: boolean;
  packaging: string | null;
  units: Unit[];
  /** How many recorded purchases would have their per-unit cost restated. */
  purchaseCount: number;
  /** A pack with no offers on it can be removed. */
  canRemove: boolean;
  /** Called once the save has gone through, so whatever holds the form can close. */
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  // Called directly rather than from a form of its own: the button sits inside
  // this form, and a form cannot hold another.
  const [removing, startRemoving] = useTransition();
  useReportPending(removing);
  const remove = () =>
    startRemoving(async () => {
      const formData = new FormData();
      formData.set("pack_size_id", packSizeId);
      formData.set("item_id", itemId);
      await removePackSize(formData);
    });

  return (
    <form
      action={async (formData) => {
        await updatePackSize(formData);
        onSaved?.();
      }}
      className="flex flex-col gap-3"
    >
      <FormResetBoundary>
        <input type="hidden" name="pack_size_id" value={packSizeId} />
        <input type="hidden" name="item_id" value={itemId} />

        <PackFields
          compact
          units={units}
          defaults={{
            soldAs: soldAsOf({ innerQuantity, unitLabel: null, packCount, soldLoose, packaging }),
            innerQuantity: String(innerQuantity),
            innerUnitId,
            packCount: String(packCount),
          }}
          defaultLabel={label}
        />

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="flex items-center gap-2">
              <SubmitButton className="btn btn-primary btn-sm">Save pack size</SubmitButton>
              {onCancel && (
                <button type="button" onClick={onCancel} className="btn btn-quiet btn-sm">
                  Cancel
                </button>
              )}
            </span>
            {purchaseCount > 0 && (
              <span className="text-support text-ink/60">
                Saving recalculates the cost per unit of {purchaseCount} recorded{" "}
                {purchaseCount === 1 ? "purchase" : "purchases"}. The expenses themselves aren&apos;t changed.
              </span>
            )}
          </div>
          {canRemove && (
            <button type="button" onClick={remove} disabled={removing} className="btn btn-quiet btn-xs text-danger">
              Remove this pack size
            </button>
          )}
        </div>
      </FormResetBoundary>
    </form>
  );
}

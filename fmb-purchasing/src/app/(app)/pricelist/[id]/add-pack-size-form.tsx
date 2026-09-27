"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { addPackSize, type AddPackSizeState } from "../actions";
import { PackFields } from "../pack-fields";

type Unit = { id: string; code: string; label: string };

const initialState: AddPackSizeState = { error: null, success: false };

/**
 * The form for another pack size on an item. A client component so it can say
 * why a pack wasn't added (#49): before, a refused insert just reloaded the
 * page and the pack never appeared.
 */
export function AddPackSizeForm({
  itemId,
  canonicalUnitId,
  units,
}: {
  itemId: string;
  canonicalUnitId: string;
  units: Unit[];
}) {
  const [state, formAction] = useActionState(addPackSize, initialState);
  return (
    <form action={formAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="item_id" value={itemId} />
      <FormResetBoundary>
        <PackFields
          units={units}
          defaults={{ soldAs: "", innerQuantity: "1", innerUnitId: canonicalUnitId, packCount: "1" }}
        />
      </FormResetBoundary>
      {state.error && (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
      <SubmitButton className="btn btn-primary self-start">Add pack size</SubmitButton>
    </form>
  );
}

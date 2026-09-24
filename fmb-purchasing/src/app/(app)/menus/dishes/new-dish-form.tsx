"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { boxSizeOptions, portionLabel } from "@/lib/menu-costing";
import { createDish, type DishFormState } from "./actions";
import { RecipeBasisFields } from "./recipe-basis-fields";

const initial: DishFormState = { error: null };

/** Names a dish and says how its recipe is written; the recipe itself follows. */
export function NewDishForm({ boxSizes }: { boxSizes: number[] }) {
  const sizes = boxSizeOptions(boxSizes);
  const [state, action] = useActionState(createDish, initial);
  const router = useRouter();

  // Straight on to the recipe, because a dish with no ingredients is not
  // finished and the next thing anybody wants is to type them.
  useEffect(() => {
    if (state.dishId) router.push(`/menus/dishes/${state.dishId}`);
  }, [state.dishId, router]);

  return (
    <form action={action} className="flex flex-col gap-3 card p-4">
      <h2 className="section-title text-ink">Add a dish</h2>
      <FormResetBoundary>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">Name</span>
            <input name="name" required placeholder="e.g. Bhuna gosht" className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">Goes in a</span>
            <select name="portion_ml" defaultValue={sizes[0]} className="input">
              {sizes.map((ml) => (
                <option key={ml} value={ml}>
                  {portionLabel(ml)}
                </option>
              ))}
            </select>
          </label>
          <RecipeBasisFields basis="batch" batchBoxes={200} />
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">
            Notes <span className="text-ink/40">(optional)</span>
          </span>
          <input name="notes" placeholder="Anything the kitchen should know" className="input" />
        </label>
      </FormResetBoundary>
      {state.error && <p className="text-sm text-alert">{state.error}</p>}
      <SubmitButton className="btn btn-primary self-start">
        Add dish
      </SubmitButton>
    </form>
  );
}

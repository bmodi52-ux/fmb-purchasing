"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { PORTION_SIZES_ML, portionLabel } from "@/lib/menu-costing";
import { createDish, type DishFormState } from "./actions";

const initial: DishFormState = { error: null };

/** Names a dish and says how its recipe is written; the recipe itself follows. */
export function NewDishForm() {
  const [state, action] = useActionState(createDish, initial);
  const router = useRouter();

  // Straight on to the recipe, because a dish with no ingredients is not
  // finished and the next thing anybody wants is to type them.
  useEffect(() => {
    if (state.dishId) router.push(`/menus/dishes/${state.dishId}`);
  }, [state.dishId, router]);

  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-white/60 p-4">
      <h2 className="section-title text-ink">Add a dish</h2>
      <FormResetBoundary>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">Name</span>
            <input name="name" required placeholder="e.g. Bhuna gosht" className="input" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">Goes in a</span>
            <select name="portion_ml" defaultValue="1000" className="input">
              {PORTION_SIZES_ML.map((ml) => (
                <option key={ml} value={ml}>
                  {portionLabel(ml)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">Recipe is written</span>
            <select name="recipe_basis" defaultValue="batch" className="input">
              <option value="batch">per batch</option>
              <option value="box">per box</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">
              Boxes per batch <span className="text-ink/40">(if per batch)</span>
            </span>
            <input name="batch_boxes" type="number" min="1" defaultValue="200" className="input" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">
            Notes <span className="text-ink/40">(optional)</span>
          </span>
          <input name="notes" placeholder="Anything the kitchen should know" className="input" />
        </label>
      </FormResetBoundary>
      {state.error && <p className="text-sm text-alert">{state.error}</p>}
      <SubmitButton className="self-start rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-deep">
        Add dish
      </SubmitButton>
    </form>
  );
}

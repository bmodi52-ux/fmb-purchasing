"use client";

import { useState } from "react";

/**
 * How a recipe is written, and — only when it needs one — how big a batch is
 * (#72).
 *
 * The two belong together: "boxes per batch" means nothing for a recipe
 * written per box, and a field that sits there labelled "(if per batch)" is a
 * field explaining that it does nothing. So the pair moves as one, and the
 * size appears when the answer is "per batch".
 */
export function RecipeBasisFields({
  basis: initialBasis,
  batchBoxes,
}: {
  basis: "batch" | "box";
  batchBoxes: number | string | null;
}) {
  const [basis, setBasis] = useState(initialBasis);

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Recipe is written</span>
        <select
          name="recipe_basis"
          value={basis}
          onChange={(e) => setBasis(e.target.value as "batch" | "box")}
          className="input"
        >
          <option value="batch">per batch</option>
          <option value="box">per box</option>
        </select>
      </label>
      {basis === "batch" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Boxes per batch</span>
          <input
            name="batch_boxes"
            type="number"
            min="1"
            defaultValue={batchBoxes ?? ""}
            required
            className="input"
          />
        </label>
      )}
    </>
  );
}

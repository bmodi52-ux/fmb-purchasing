import { SubmitButton } from "@/components/submit-button";
import { portionLabel } from "@/lib/menu-costing";
import { addBoxSize, removeBoxSize } from "./actions";

/**
 * The sizes a dish can be portioned into (#70).
 *
 * The form used to offer six, of which the kitchen fills two. Guessing again
 * would only go stale, so the list lives here instead: whoever knows what the
 * kitchen packs can put a size on it or take one off, without a deploy.
 */
export function BoxSizes({ sizes }: { sizes: { ml: number; dishes: number }[] }) {
  return (
    <section className="card p-4">
      <h2 className="section-title text-ink">Box sizes</h2>
      <p className="mt-1 text-sm text-ink/55">
        What a dish can be portioned into. Taking a size off only removes it from the list — a dish written for it
        keeps it.
      </p>

      <ul className="mt-3 flex flex-wrap gap-2">
        {sizes.map((size) => (
          <li
            key={size.ml}
            className="flex items-baseline gap-2 rounded-md border border-ink/15 bg-white px-3 py-1.5 text-sm"
          >
            <span className="text-ink">{portionLabel(size.ml)}</span>
            <span className="text-xs text-ink/45">
              {size.dishes} {size.dishes === 1 ? "dish" : "dishes"}
            </span>
            <form action={removeBoxSize}>
              <input type="hidden" name="ml" value={size.ml} />
              <SubmitButton
                className="text-xs text-ink/40 hover:text-alert"
                aria-label={`Remove ${portionLabel(size.ml)}`}
              >
                ×
              </SubmitButton>
            </form>
          </li>
        ))}
        {sizes.length === 0 && <li className="text-sm text-ink/55">No sizes on the list.</li>}
      </ul>

      <form action={addBoxSize} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Add a size</span>
          <div className="flex items-baseline gap-1.5">
            <input
              name="ml"
              type="number"
              min="1"
              step="1"
              required
              placeholder="e.g. 400"
              className="input w-28 py-1"
            />
            <span className="text-sm text-ink/55">ml</span>
          </div>
        </label>
        <SubmitButton className="btn btn-secondary btn-sm">
          Add
        </SubmitButton>
      </form>
    </section>
  );
}

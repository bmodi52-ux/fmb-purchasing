"use client";

import { useActionState, useRef, useState } from "react";
import { saveBudget, type BudgetSaveState } from "./actions";

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/**
 * One category's budget for the period on screen, saved when you leave the
 * field.
 *
 * Blur rather than a button: setting a year's budgets is a column of numbers
 * typed one after another, and a row where a save step is forgotten is a row
 * that quietly did not save. Only submits when the value actually changed, so
 * tabbing through the table to read it writes nothing.
 *
 * When the figure would change a budget already set (#22), nothing is saved
 * and the warning says exactly what an override would do to which budget.
 */
export function BudgetInput({
  categoryId,
  categoryLabel,
  period,
  defaultValue,
  placeholder,
}: {
  categoryId: string;
  categoryLabel: string;
  period: string;
  /** The budget set for exactly this period, if there is one. */
  defaultValue: number | null;
  /** What the budgets already set put in this period, shown when nothing is set for exactly it. */
  placeholder: string;
}) {
  const [state, action, pending] = useActionState<BudgetSaveState, FormData>(saveBudget, { status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const lastSaved = useRef(defaultValue == null ? "" : String(defaultValue));
  const [dismissed, setDismissed] = useState<BudgetSaveState | null>(null);
  const conflict = state.status === "conflict" && dismissed !== state ? state : null;

  function commit(el: HTMLInputElement) {
    if (el.value === lastSaved.current) return;
    lastSaved.current = el.value;
    formRef.current?.requestSubmit();
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <form ref={formRef} action={action} className="flex justify-end">
        <input type="hidden" name="category_id" value={categoryId} />
        <input type="hidden" name="period" value={period} />
        <input
          type="number"
          step="0.01"
          min="0"
          name="amount"
          defaultValue={defaultValue ?? ""}
          placeholder={placeholder}
          aria-label={`Budget for ${categoryLabel}`}
          onBlur={(e) => commit(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            commit(e.currentTarget);
          }}
          className={`w-32 rounded border bg-white px-2 py-1 text-right font-mono ${
            conflict ? "border-maroon/50" : "border-ink/15"
          } ${pending ? "opacity-60" : ""}`}
        />
      </form>

      {state.status === "error" && <p className="max-w-[16rem] text-right text-xs text-maroon">{state.message}</p>}

      {conflict && (
        <div role="alert" className="max-w-xs rounded-md border border-maroon/30 bg-maroon/5 px-3 py-2 text-left text-xs">
          <p className="font-medium text-maroon">This changes a budget already set</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-ink/75">
            {conflict.changes.map((c) => (
              <li key={c.label}>
                {c.label} {categoryLabel} will change from {money(c.from)} to {money(c.to)}.
              </li>
            ))}
            {conflict.changes.length === 0 && (
              <li>The budgets already covering these days leave no room for this amount.</li>
            )}
          </ul>
          <form action={action} className="mt-2 flex items-center gap-3">
            <input type="hidden" name="category_id" value={categoryId} />
            <input type="hidden" name="period" value={period} />
            <input type="hidden" name="amount" value={conflict.amount} />
            <input type="hidden" name="override" value="1" />
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-maroon px-2.5 py-1 font-medium text-cream hover:bg-maroon/90 disabled:opacity-60"
            >
              Override
            </button>
            <button
              type="button"
              onClick={() => {
                // Back to what is actually saved, since the typed figure was not.
                setDismissed(state);
                const saved = defaultValue == null ? "" : String(defaultValue);
                lastSaved.current = saved;
                const field = formRef.current?.elements.namedItem("amount");
                if (field instanceof HTMLInputElement) field.value = saved;
              }}
              className="text-ink/60 underline hover:text-ink"
            >
              Cancel
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

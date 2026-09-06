"use client";

import { useRef } from "react";

/**
 * One budget figure, saved when you leave the field.
 *
 * This was a plain input inside a form with a visually-hidden submit button,
 * on the assumption that Enter would submit it the way Enter submits any
 * single-field form. It does not — tested against the running app, the
 * keypress does nothing and the figure is silently discarded, which is the
 * worst possible outcome for a field someone fills in eighteen times and then
 * navigates away from believing it saved.
 *
 * Blur is also simply the better interaction here. Setting a year's budgets is
 * a column of numbers typed one after another; requiring a keystroke or a
 * button per row makes a chore out of it, and any row where that step is
 * forgotten is a row that quietly did not save.
 *
 * Only submits when the value actually changed, so tabbing through the table
 * to read it does not write eighteen identical rows.
 */
export function BudgetInput({
  defaultValue,
  ariaLabel,
}: {
  defaultValue: number | null;
  ariaLabel: string;
}) {
  const lastSaved = useRef(defaultValue == null ? "" : String(defaultValue));

  function commit(el: HTMLInputElement) {
    if (el.value === lastSaved.current) return;
    lastSaved.current = el.value;
    el.form?.requestSubmit();
  }

  return (
    <input
      type="number"
      step="0.01"
      min="0"
      name="amount"
      defaultValue={defaultValue ?? ""}
      placeholder="—"
      aria-label={ariaLabel}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        // Prevented because the implicit submission this would otherwise
        // trigger is exactly what does not work here.
        e.preventDefault();
        commit(e.currentTarget);
      }}
      className="w-28 rounded border border-ink/15 bg-white px-2 py-1 text-right font-mono"
    />
  );
}

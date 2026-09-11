"use client";

import { useState } from "react";
import { setBudgetPhasing } from "./actions";

/**
 * Monthly shares for a whole-year budget (#39). Twelve percentages that add up
 * to 100; the running total says how far off they are before saving.
 */
export function BudgetPhasing({
  budgetId,
  months,
  percents,
}: {
  budgetId: string;
  /** The twelve month labels of the budget's own year, in order. */
  months: string[];
  /** Current shares, or null when the budget is spread evenly. */
  percents: number[] | null;
}) {
  const [values, setValues] = useState<string[]>(
    percents ? percents.map((p) => String(Math.round(p * 100) / 100)) : Array(12).fill("")
  );
  const [error, setError] = useState<string | null>(null);
  const sum = values.reduce((s, v) => s + (Number(v) || 0), 0);
  const blank = values.every((v) => v === "");

  return (
    <details className="mt-1 text-left text-xs">
      <summary className="cursor-pointer text-ink/55 underline hover:text-ink">
        {percents ? "Phased by month" : "Phase by month"}
      </summary>
      <form
        action={async (formData) => {
          setError(null);
          try {
            await setBudgetPhasing(formData);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
        className="mt-2 flex w-72 flex-col gap-2 rounded-md border border-ink/10 bg-white p-3 shadow-sm"
      >
        <input type="hidden" name="budget_id" value={budgetId} />
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          {months.map((label, i) => (
            <label key={label} className="flex items-center justify-between gap-2">
              <span className="truncate text-ink/70">{label}</span>
              <span className="flex items-center gap-0.5">
                <input
                  name={`month_${i + 1}`}
                  value={values[i]}
                  inputMode="decimal"
                  onChange={(e) => setValues((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                  className="w-14 rounded border border-ink/15 px-1 py-0.5 text-right font-mono"
                  aria-label={`${label} share`}
                />
                %
              </span>
            </label>
          ))}
        </div>
        <p className={`${blank || Math.abs(sum - 100) <= 0.5 ? "text-ink/55" : "text-maroon"}`}>
          {blank ? "All blank: spread evenly by day." : `Adds up to ${Math.round(sum * 10) / 10}%`}
        </p>
        <div className="flex items-center gap-3">
          <button type="submit" className="rounded-md bg-gold px-3 py-1 font-medium text-ink hover:bg-gold-deep">
            Save
          </button>
          <button type="button" onClick={() => setValues(Array(12).fill(""))} className="text-ink/55 underline">
            Spread evenly
          </button>
        </div>
        {error && <p className="text-maroon">{error}</p>}
      </form>
    </details>
  );
}

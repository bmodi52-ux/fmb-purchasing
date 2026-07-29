"use client";

import { formatFiscalYear, ALL_YEARS } from "@/lib/fiscal-year";

/**
 * Scopes a page to one fiscal year, via a plain form so the choice lands in
 * the URL and the server does the filtering. Shared by Reports and All
 * Expenses, which both want the same control and the same vocabulary.
 */
export function FiscalYearSelect({
  fiscalYears,
  selectedFy,
  currentFy,
  allowAllYears = false,
}: {
  fiscalYears: number[];
  /** A year, or ALL_YEARS when the filter is off. */
  selectedFy: number | typeof ALL_YEARS;
  currentFy: number;
  allowAllYears?: boolean;
}) {
  return (
    <form className="flex items-center gap-2 text-sm">
      <label className="text-ink/60" htmlFor="fy">
        Fiscal year
      </label>
      <select
        id="fy"
        name="fy"
        defaultValue={String(selectedFy)}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="input"
      >
        {fiscalYears.map((y) => (
          <option key={y} value={y}>
            {formatFiscalYear(y)}
            {y === currentFy ? " (current)" : ""}
          </option>
        ))}
        {allowAllYears && <option value={ALL_YEARS}>All years</option>}
      </select>
    </form>
  );
}

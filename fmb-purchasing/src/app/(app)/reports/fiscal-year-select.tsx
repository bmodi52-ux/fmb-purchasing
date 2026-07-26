"use client";

import { formatFiscalYear } from "@/lib/fiscal-year";

export function FiscalYearSelect({
  fiscalYears,
  selectedFy,
  currentFy,
}: {
  fiscalYears: number[];
  selectedFy: number;
  currentFy: number;
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
      </select>
    </form>
  );
}

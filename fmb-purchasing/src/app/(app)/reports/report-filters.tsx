"use client";

import { formatFiscalYear } from "@/lib/fiscal-year";
import { formatMonthLabel } from "./aggregate";

export type FilterOption = { value: string; label: string };

/**
 * One row, above everything it scopes.
 *
 * Plain GET form controls that write to the URL: the whole dashboard is a
 * server render of `searchParams`, so a view can be linked to a colleague,
 * the back button steps through what you looked at, and a reload doesn't
 * lose where you were. Changing any control resubmits the form, which
 * carries the other selections along in the same submission.
 */
export function ReportFilters({
  fiscalYears,
  currentFy,
  selectedFy,
  months,
  selectedMonth,
  vendors,
  selectedVendor,
  categories,
  selectedCategory,
  items,
  selectedItem,
  isFiltered,
}: {
  fiscalYears: number[];
  currentFy: number;
  selectedFy: number;
  months: string[];
  selectedMonth: string;
  vendors: FilterOption[];
  selectedVendor: string;
  categories: FilterOption[];
  selectedCategory: string;
  items: FilterOption[];
  selectedItem: string;
  isFiltered: boolean;
}) {
  return (
    <form className="flex flex-wrap items-end gap-x-3 gap-y-3 rounded-xl border border-ink/10 bg-white/60 p-3">
      <Field label="Fiscal year" name="fy" value={String(selectedFy)}>
        {fiscalYears.map((y) => (
          <option key={y} value={y}>
            {formatFiscalYear(y)}
            {y === currentFy ? " (current)" : ""}
          </option>
        ))}
      </Field>

      <Field label="Month" name="month" value={selectedMonth}>
        <option value="">Whole year</option>
        {months.map((m) => (
          <option key={m} value={m}>
            {formatMonthLabel(m)}
          </option>
        ))}
      </Field>

      <Field label="Vendor" name="vendor" value={selectedVendor}>
        <option value="">All vendors</option>
        {vendors.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        ))}
      </Field>

      <Field label="Category" name="category" value={selectedCategory}>
        <option value="">All categories</option>
        {categories.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Field>

      <Field label="Item" name="item" value={selectedItem}>
        <option value="">All items</option>
        {items.map((i) => (
          <option key={i.value} value={i.value}>
            {i.label}
          </option>
        ))}
      </Field>

      {isFiltered && (
        // A plain link, not a reset button: it has to clear the URL, and the
        // browser's own form reset would only restore the last submitted
        // selections rather than clearing them.
        <a
          href={`/reports?fy=${selectedFy}`}
          className="pb-2 text-xs text-ink/50 underline hover:text-ink"
        >
          Clear filters
        </a>
      )}

      {/* Anyone with scripting off still gets a working dashboard. */}
      <noscript>
        <button type="submit" className="rounded-md bg-gold px-3 py-2 text-xs font-medium text-ink">
          Apply
        </button>
      </noscript>
    </form>
  );
}

function Field({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-ink/55">{label}</span>
      <select
        name={name}
        defaultValue={value}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="input max-w-[13rem] text-sm"
      >
        {children}
      </select>
    </label>
  );
}

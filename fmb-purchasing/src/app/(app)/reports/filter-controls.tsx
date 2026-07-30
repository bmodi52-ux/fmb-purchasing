"use client";

import { useRouter } from "next/navigation";
import { formatFiscalYear } from "@/lib/fiscal-year";
import { formatMonthLabel } from "./aggregate";
import { MultiSelectMenu } from "./multi-select-menu";
import { buildHref, type ReportQuery, type FilterOption } from "./report-filters";

/**
 * The filter row's controls.
 *
 * Fiscal year and month are single-choice, so they stay plain selects.
 * Vendors, categories and items are searchable multi-select menus — those
 * lists grow with the business, and a row of chips per item would eventually
 * be taller than the charts underneath it.
 */
export function FilterControls({
  query,
  fiscalYears,
  currentFy,
  months,
  vendors,
  categories,
  items,
}: {
  query: ReportQuery;
  fiscalYears: number[];
  currentFy: number;
  months: string[];
  vendors: FilterOption[];
  categories: FilterOption[];
  items: FilterOption[];
}) {
  const router = useRouter();
  const go = (patch: Partial<ReportQuery>) => router.push(buildHref(query, patch));

  return (
    <>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-ink/55">Fiscal year</span>
        <select
          value={String(query.fy)}
          // Changing year clears the month: the months on offer belong to the
          // year on screen, so carrying one over would select nothing.
          onChange={(e) => go({ fy: Number(e.target.value), month: "" })}
          className="input max-w-[11rem] text-sm"
        >
          {fiscalYears.map((y) => (
            <option key={y} value={y}>
              {formatFiscalYear(y)}
              {y === currentFy ? " (current)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="text-ink/55">Month</span>
        <select
          value={query.month}
          onChange={(e) => go({ month: e.target.value })}
          className="input max-w-[10rem] text-sm"
        >
          <option value="">Whole year</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonthLabel(m)}
            </option>
          ))}
        </select>
      </label>

      <MultiSelectMenu
        label="Vendors"
        options={vendors}
        selected={query.vendors}
        onApply={(next) => go({ vendors: next })}
      />
      <MultiSelectMenu
        label="Categories"
        options={categories}
        selected={query.categories}
        onApply={(next) => go({ categories: next })}
      />
      <MultiSelectMenu
        label="Items"
        options={items}
        selected={query.items}
        onApply={(next) => go({ items: next })}
      />
    </>
  );
}

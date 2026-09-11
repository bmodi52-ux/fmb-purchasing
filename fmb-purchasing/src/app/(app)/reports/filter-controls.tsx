"use client";

import { useRouter } from "next/navigation";
import { PeriodPicker } from "@/components/period-picker";
import { MultiSelectMenu } from "./multi-select-menu";
import { buildHref, type ReportQuery, type FilterOption } from "./report-filters";

/**
 * The filter row's controls.
 *
 * The period is one picker — any kind of year, a quarter, a month or a range
 * (#22). Vendors, categories and items are searchable multi-select menus —
 * those lists grow with the business, and a row of chips per item would
 * eventually be taller than the charts underneath it.
 */
export function FilterControls({
  query,
  today,
  earliest,
  vendors,
  categories,
  items,
}: {
  query: ReportQuery;
  today: string;
  earliest: string | null;
  vendors: FilterOption[];
  categories: FilterOption[];
  items: FilterOption[];
}) {
  const router = useRouter();
  const go = (patch: Partial<ReportQuery>) => router.push(buildHref(query, patch));

  return (
    <>
      <PeriodPicker value={query.period} today={today} earliest={earliest} onChange={(period) => go({ period })} />

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

"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PeriodPicker } from "@/components/period-picker";
import type { FilterOption } from "@/lib/reporting/aggregate";
import { STATUS_BASES, type StatusBasis } from "@/lib/reporting/basis";
import { MultiSelectMenu } from "./multi-select-menu";

/** The standard filters (lib/reporting/filters); a report's registry entry says which it takes. */
export type FilterKey = "period" | "vendor" | "category" | "item" | "counting";

/**
 * The filter row of every report: the same controls, in the same order,
 * writing the same words into the address — `period`, `vendor`, `category`,
 * `item`, `status`. A report shows the ones it can honour and no others.
 *
 * The address is the only state. Each control changes its own part of it and
 * leaves the rest, so a section, a sort order or another filter survives; the
 * page number does not, since a narrower list has different pages.
 */
export function ReportFilterBar({
  filters,
  period,
  today,
  earliest,
  options = {},
  selected = {},
  counting,
  children,
}: {
  filters: FilterKey[];
  /** The period's code, when the report takes a period. */
  period?: string;
  today: string;
  earliest: string | null;
  options?: { vendors?: FilterOption[]; categories?: FilterOption[]; items?: FilterOption[] };
  selected?: { vendors?: string[]; categories?: string[]; items?: string[] };
  counting?: StatusBasis;
  /** Controls of the report's own, after the standard ones. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const hrefWith = (patch: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams(search.toString());
    for (const [key, value] of Object.entries(patch)) {
      next.delete(key);
      if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
      else if (value) next.set(key, value);
    }
    next.delete("page");
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  const go = (patch: Record<string, string | string[] | null>) => router.push(hrefWith(patch));

  const has = (key: FilterKey) => filters.includes(key);
  const vendors = selected.vendors ?? [];
  const categories = selected.categories ?? [];
  const items = selected.items ?? [];
  const isFiltered = vendors.length + categories.length + items.length > 0;

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-3 card p-3">
      {has("period") && period !== undefined && (
        <PeriodPicker value={period} today={today} earliest={earliest} onChange={(code) => go({ period: code })} />
      )}

      {has("vendor") && (
        <MultiSelectMenu label="Vendors" options={options.vendors ?? []} selected={vendors} onApply={(next) => go({ vendor: next })} />
      )}
      {has("category") && (
        <MultiSelectMenu
          label="Categories"
          options={options.categories ?? []}
          selected={categories}
          onApply={(next) => go({ category: next })}
        />
      )}
      {has("item") && (
        <MultiSelectMenu label="Items" options={options.items ?? []} selected={items} onApply={(next) => go({ item: next })} />
      )}

      {/* Which expenses count. Everything live by default, which is what a
          budget is used up by; approved and paid is what the GST return
          counts, so a figure here can be put beside Accounting's. */}
      {has("counting") && counting && (
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-ink/55">Counting</span>
          <div className="segmented">
            {STATUS_BASES.map((b) => (
              <Link
                key={b.key}
                href={hrefWith({ status: b.key === "spend" ? null : b.key })}
                aria-current={counting === b.key ? "true" : undefined}
                className="segment"
              >
                {b.short}
              </Link>
            ))}
          </div>
        </div>
      )}

      {isFiltered && (
        <Link
          href={hrefWith({ vendor: null, category: null, item: null })}
          className="pb-2.5 text-xs text-ink/50 underline hover:text-ink"
        >
          Clear filters
        </Link>
      )}

      {children}
    </div>
  );
}

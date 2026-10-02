"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PeriodMenu } from "@/components/period-menu";
import type { FilterOption } from "@/lib/reporting/aggregate";
import { STATUS_BASES, type StatusBasis } from "@/lib/reporting/basis";
import { MultiSelectMenu } from "./multi-select-menu";

/** The standard filters (lib/reporting/filters); a report's registry entry says which it takes. */
export type FilterKey = "period" | "vendor" | "category" | "item" | "counting";

/** How many chosen filters are named under the row before the rest are counted. */
const CHIPS = 6;

/**
 * The filter row of every report: the same controls, in the same order,
 * writing the same words into the address — `period`, `vendor`, `category`,
 * `item`, `status`. A report shows the ones it can honour and no others.
 *
 * One row of controls. What a report has been narrowed to is then named
 * underneath, each choice with a way to take it back, so a filtered page
 * says so in words rather than by a menu reading "2 selected".
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
  lead,
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
  /** Which part of the report is showing, before any filter: its sections, as one control. */
  lead?: React.ReactNode;
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

  // Everything the report is narrowed to, in the order the menus stand.
  const chosen = (
    [
      ["vendor", vendors, options.vendors],
      ["category", categories, options.categories],
      ["item", items, options.items],
    ] as const
  ).flatMap(([param, values, list]) =>
    values.map((value) => ({
      param,
      value,
      label: list?.find((o) => o.value === value)?.label ?? value,
      without: values.filter((v) => v !== value),
    }))
  );

  return (
    <div className="flex flex-col gap-2.5 card px-4 py-3">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
        {lead}
        {has("period") && period !== undefined && (
          <PeriodMenu value={period} today={today} earliest={earliest} onChange={(code) => go({ period: code })} />
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
          <div className="flex flex-col gap-1 text-support">
            <span className="font-medium text-ink/70">Counting</span>
            <div className="segmented">
              {STATUS_BASES.map((b) => (
                <Link
                  key={b.key}
                  href={hrefWith({ status: b.key === "spend" ? null : b.key })}
                  aria-current={counting === b.key ? "true" : undefined}
                  className="segment py-[0.4rem]"
                >
                  {b.short}
                </Link>
              ))}
            </div>
          </div>
        )}

        {children}
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-support text-ink/70">Narrowed to</span>
          {chosen.slice(0, CHIPS).map((c) => (
            <Link key={`${c.param}:${c.value}`} href={hrefWith({ [c.param]: c.without })} className="chip" title={`Remove ${c.label}`}>
              <span className="min-w-0 truncate">{c.label}</span>
              <span aria-hidden="true">×</span>
              <span className="sr-only">, remove</span>
            </Link>
          ))}
          {chosen.length > CHIPS && <span className="text-support text-ink/70">and {chosen.length - CHIPS} more</span>}
          <Link
            href={hrefWith({ vendor: null, category: null, item: null })}
            className="ml-1 text-support text-brand underline underline-offset-[3px]"
          >
            Clear filters
          </Link>
        </div>
      )}
    </div>
  );
}

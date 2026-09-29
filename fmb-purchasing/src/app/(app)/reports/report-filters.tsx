import Link from "next/link";
import type { FilterOption } from "@/lib/reporting/aggregate";
import { STATUS_BASES } from "@/lib/reporting/basis";
import { SECTIONS, buildHref, type ReportQuery, type ReportSection } from "@/lib/reporting/query";
import { FilterControls } from "./filter-controls";

export type { FilterOption };

export function SectionTabs({ query, active }: { query: ReportQuery; active: ReportSection }) {
  return (
    <nav aria-label="Report sections" className="tabs border-b-0">
      {SECTIONS.map((s) => {
        const isActive = s.key === active;
        return (
          <Link
            key={s.key}
            href={buildHref(query, { section: s.key })}
            aria-current={isActive ? "page" : undefined}
            className="tab"
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ReportFilters({
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
  const isFiltered = query.vendors.length > 0 || query.categories.length > 0 || query.items.length > 0;

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-3 card p-3">
      <FilterControls
        query={query}
        today={today}
        earliest={earliest}
        vendors={vendors}
        categories={categories}
        items={items}
      />

      {/* Which expenses count. Everything live by default, which is what a
          budget is used up by; approved and paid is what the GST return
          counts, so a figure here can be put beside Accounting's. */}
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-ink/55">Counting</span>
        <div className="segmented">
          {STATUS_BASES.map((b) => (
            <Link
              key={b.key}
              href={buildHref(query, { status: b.key })}
              aria-current={query.status === b.key ? "true" : undefined}
              className="segment"
            >
              {b.short}
            </Link>
          ))}
        </div>
      </div>

      {isFiltered && (
        <Link
          href={buildHref(query, { vendors: [], categories: [], items: [] })}
          className="pb-2.5 text-xs text-ink/50 underline hover:text-ink"
        >
          Clear filters
        </Link>
      )}
    </div>
  );
}

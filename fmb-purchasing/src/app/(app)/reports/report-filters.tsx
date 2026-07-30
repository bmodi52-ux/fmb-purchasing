import Link from "next/link";
import { FilterControls } from "./filter-controls";

export type FilterOption = { value: string; label: string };

export type ReportSection =
  | "overview"
  | "categories"
  | "vendors"
  | "items"
  | "compare"
  | "unit-costs";

export const SECTIONS: { key: ReportSection; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "categories", label: "Categories" },
  { key: "vendors", label: "Vendors" },
  { key: "items", label: "Items" },
  { key: "compare", label: "Compare" },
  { key: "unit-costs", label: "Unit costs" },
];

export type CompareDimension = "item" | "category" | "vendor";

export type ReportQuery = {
  fy: number;
  section: ReportSection;
  month: string;
  vendors: string[];
  categories: string[];
  items: string[];
  compareBy: CompareDimension;
};

/**
 * Rebuilds the page URL with one thing changed.
 *
 * Every control resolves to one of these, so the URL is the only state there
 * is: a view can be linked, the back button steps through what you looked
 * at, and no client-side selection can drift out of step with what's shown.
 */
export function buildHref(query: ReportQuery, patch: Partial<ReportQuery>): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();

  params.set("fy", String(next.fy));
  if (next.section !== "overview") params.set("section", next.section);
  if (next.month) params.set("month", next.month);
  if (next.compareBy !== "item") params.set("compareBy", next.compareBy);
  for (const v of next.vendors) params.append("vendor", v);
  for (const c of next.categories) params.append("category", c);
  for (const i of next.items) params.append("item", i);

  return `/reports?${params.toString()}`;
}

export function SectionTabs({ query, active }: { query: ReportQuery; active: ReportSection }) {
  return (
    <nav aria-label="Report sections" className="flex flex-wrap gap-1.5">
      {SECTIONS.map((s) => {
        const isActive = s.key === active;
        return (
          <Link
            key={s.key}
            href={buildHref(query, { section: s.key })}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              isActive
                ? "bg-gold font-medium text-ink"
                : "border border-ink/15 text-ink/65 hover:border-ink/30 hover:text-ink"
            }`}
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
  const isFiltered =
    !!query.month ||
    query.vendors.length > 0 ||
    query.categories.length > 0 ||
    query.items.length > 0;

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-3 rounded-xl border border-ink/10 bg-white/60 p-3">
      <FilterControls
        query={query}
        fiscalYears={fiscalYears}
        currentFy={currentFy}
        months={months}
        vendors={vendors}
        categories={categories}
        items={items}
      />

      {isFiltered && (
        <Link
          href={buildHref(query, { month: "", vendors: [], categories: [], items: [] })}
          className="pb-2.5 text-xs text-ink/50 underline hover:text-ink"
        >
          Clear filters
        </Link>
      )}
    </div>
  );
}

import Link from "next/link";
import { formatFiscalYear } from "@/lib/fiscal-year";
import { formatMonthLabel } from "./aggregate";
import { FilterSelects } from "./filter-selects";

export type FilterOption = { value: string; label: string };

export type ReportSection = "overview" | "categories" | "vendors" | "items" | "unit-costs";

export const SECTIONS: { key: ReportSection; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "categories", label: "Categories" },
  { key: "vendors", label: "Vendors" },
  { key: "items", label: "Items" },
  { key: "unit-costs", label: "Unit costs" },
];

export type ReportQuery = {
  fy: number;
  section: ReportSection;
  month: string;
  vendor: string;
  categories: string[];
  items: string[];
};

/**
 * Rebuilds the page URL with one thing changed.
 *
 * Everything is a link rather than a form submission, which is what lets the
 * multi-selects be toggle chips: each chip is just this URL with its own id
 * added or removed. No JavaScript required, and every state is addressable.
 */
export function buildHref(query: ReportQuery, patch: Partial<ReportQuery>): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();

  params.set("fy", String(next.fy));
  if (next.section !== "overview") params.set("section", next.section);
  if (next.month) params.set("month", next.month);
  if (next.vendor) params.set("vendor", next.vendor);
  for (const c of next.categories) params.append("category", c);
  for (const i of next.items) params.append("item", i);

  return `/reports?${params.toString()}`;
}

/** Adds or removes one value from a multi-select dimension. */
function toggled(current: string[], value: string): string[] {
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
}

export function SectionTabs({
  query,
  active,
}: {
  query: ReportQuery;
  active: ReportSection;
}) {
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
                ? "bg-gold text-ink font-medium"
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
    !!query.month || !!query.vendor || query.categories.length > 0 || query.items.length > 0;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ink/10 bg-white/60 p-3">
      <FilterSelects
        query={query}
        fiscalYears={fiscalYears.map((y) => ({
          value: String(y),
          label: `${formatFiscalYear(y)}${y === currentFy ? " (current)" : ""}`,
        }))}
        months={months.map((m) => ({ value: m, label: formatMonthLabel(m) }))}
        vendors={vendors}
      />

      <ChipRow
        label="Categories"
        options={categories}
        selected={query.categories}
        hrefFor={(value) => buildHref(query, { categories: toggled(query.categories, value) })}
        clearHref={buildHref(query, { categories: [] })}
      />

      <ChipRow
        label="Items"
        options={items}
        selected={query.items}
        hrefFor={(value) => buildHref(query, { items: toggled(query.items, value) })}
        clearHref={buildHref(query, { items: [] })}
      />

      {isFiltered && (
        <div className="flex justify-end">
          <Link
            href={buildHref(query, { month: "", vendor: "", categories: [], items: [] })}
            className="text-xs text-ink/50 underline hover:text-ink"
          >
            Clear all filters
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * A toggle chip per option. Several chips on in one row is an OR; chips on
 * across two rows AND together — see `applyFilters`.
 */
function ChipRow({
  label,
  options,
  selected,
  hrefFor,
  clearHref,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  hrefFor: (value: string) => string;
  clearHref: string;
}) {
  if (options.length === 0) return null;

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1.5 border-t border-ink/5 pt-2.5">
      <span className="w-16 shrink-0 text-xs text-ink/55">{label}</span>

      <Link
        href={clearHref}
        aria-pressed={selected.length === 0}
        className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
          selected.length === 0
            ? "bg-ink/10 text-ink"
            : "border border-ink/15 text-ink/55 hover:border-ink/30 hover:text-ink"
        }`}
      >
        All
      </Link>

      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <Link
            key={o.value}
            href={hrefFor(o.value)}
            aria-pressed={on}
            title={o.label}
            className={`max-w-[14rem] truncate rounded-full px-2.5 py-1 text-xs transition-colors ${
              on
                ? "bg-gold/25 text-ink ring-1 ring-gold/50"
                : "border border-ink/15 text-ink/60 hover:border-ink/30 hover:text-ink"
            }`}
          >
            {on && <span aria-hidden="true">✓ </span>}
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

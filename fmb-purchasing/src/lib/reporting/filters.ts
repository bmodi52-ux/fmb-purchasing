/**
 * The filters every report draws from, read the same way everywhere.
 *
 * A report takes whichever of these it can honour (its registry entry says
 * which) and the filter bar shows those. They are always spelt the same in
 * the address — `period`, `vendor`, `category`, `item`, `status` — so a
 * filter set on one report means the same on the next, and a link, a saved
 * view or a widget carries it without translation.
 *
 * Cost centre, project and currency are not here because an expense records
 * none of them: there is nothing to filter by.
 *
 * Pure, and safe for the browser.
 */

import type { FilterOption } from "./aggregate.ts";
import type { StatusBasis } from "./basis.ts";
import { normaliseQuery } from "./query.ts";

type Params = Record<string, string | string[] | undefined>;

export type StandardFilters = {
  vendors: string[];
  categories: string[];
  items: string[];
  /** Which expenses count (basis.ts). */
  status: StatusBasis;
};

export const NO_STANDARD_FILTERS: StandardFilters = { vendors: [], categories: [], items: [], status: "spend" };

/** The standard filters as a page's address carries them. The period is read apart, by parsePeriod. */
export function standardFilters(params: Params): StandardFilters {
  const q = normaliseQuery({
    period: "x",
    status: params.status,
    vendors: params.vendor,
    categories: params.category,
    items: params.item,
  })!;
  return { vendors: q.vendors, categories: q.categories, items: q.items, status: q.status };
}

/**
 * How a vendor is keyed in a filter: by its record, or by the name on the
 * receipt when it has none — the same key the Spending report uses, so a
 * vendor chosen there is the same vendor here.
 */
export function vendorKey(vendorId: string | null, label: string): string {
  return vendorId ?? `raw:${label}`;
}

/** The options a list of keyed things gives a filter menu: one of each, by name. */
export function optionsOf(pairs: { key: string; label: string }[]): FilterOption[] {
  return [...new Map(pairs.map((p) => [p.key, p.label])).entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Only what is on offer: a filter carried over from another period or report
 * that matches nothing here is dropped, rather than silently selecting nothing.
 */
export function offered(selected: string[], options: FilterOption[]): string[] {
  const values = new Set(options.map((o) => o.value));
  return selected.filter((v) => values.has(v));
}

/** "Vendors: Costco, Harris Farm · Categories: Meat" — for a download's subtitle; "" when nothing is filtered. */
export function describeSelection(
  selected: Partial<Pick<StandardFilters, "vendors" | "categories" | "items">>,
  options: { vendors?: FilterOption[]; categories?: FilterOption[]; items?: FilterOption[] }
): string {
  const names = (ids: string[] | undefined, from: FilterOption[] | undefined) =>
    (ids ?? []).map((id) => from?.find((o) => o.value === id)?.label ?? id);
  const parts: string[] = [];
  const v = names(selected.vendors, options.vendors);
  const c = names(selected.categories, options.categories);
  const i = names(selected.items, options.items);
  if (v.length > 0) parts.push(`Vendors: ${v.join(", ")}`);
  if (c.length > 0) parts.push(`Categories: ${c.join(", ")}`);
  if (i.length > 0) parts.push(`Items: ${i.join(", ")}`);
  return parts.join(" · ");
}

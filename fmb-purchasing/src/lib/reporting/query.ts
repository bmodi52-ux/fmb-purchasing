/**
 * What a report is showing, as the URL and a saved view carry it.
 *
 * The URL is the only state the Reports page has: a view can be linked, the
 * back button steps through what you looked at, and nothing on screen can
 * drift out of step with what was computed. It used to be read in two places
 * — the page, and the saved-view actions — each with its own idea of what a
 * valid value was. Both read it here now, and so does anything that opens a
 * saved view, which is where a query saved before a field existed gets that
 * field's default.
 */

import { parseStatusBasis, type StatusBasis } from "./basis.ts";

/** Where the Spending report lives. /reports itself is the dashboard. */
export const SPENDING_PATH = "/reports/spending";

export type ReportSection = "overview" | "breakdown" | "compare" | "unit-costs" | "transactions";

export const SECTIONS: { key: ReportSection; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "breakdown", label: "Breakdown" },
  { key: "compare", label: "Compare" },
  { key: "unit-costs", label: "Unit costs" },
  { key: "transactions", label: "Transactions" },
];

export type CompareDimension = "item" | "category" | "vendor";

export const DIMENSIONS: CompareDimension[] = ["item", "category", "vendor"];

export type ReportQuery = {
  /** A period code from lib/periods — any kind of year, a quarter, a month or a range. */
  period: string;
  section: ReportSection;
  /** Which expenses count (lib/reporting/basis). */
  status: StatusBasis;
  vendors: string[];
  categories: string[];
  items: string[];
  breakdownBy: CompareDimension;
  compareBy: CompareDimension;
};

/** Ids are uuids or "raw:<name>" keys; anything longer is not one of ours. */
const MAX_ID = 200;
const MAX_IDS = 200;

function idList(value: unknown): string[] {
  const list = value == null ? [] : Array.isArray(value) ? value : [value];
  return list.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= MAX_ID).slice(0, MAX_IDS);
}

function dimension(value: unknown, fallback: CompareDimension): CompareDimension {
  return DIMENSIONS.includes(value as CompareDimension) ? (value as CompareDimension) : fallback;
}

/**
 * A query with every value checked and every default filled, from its parts
 * however they arrived. Null when there is no usable period.
 */
export function normaliseQuery(parts: {
  period: unknown;
  section?: unknown;
  status?: unknown;
  vendors?: unknown;
  categories?: unknown;
  items?: unknown;
  breakdownBy?: unknown;
  compareBy?: unknown;
}): ReportQuery | null {
  const period = typeof parts.period === "string" && parts.period.length > 0 && parts.period.length <= 64 ? parts.period : null;
  if (!period) return null;
  return {
    period,
    section: SECTIONS.some((s) => s.key === parts.section) ? (parts.section as ReportSection) : "overview",
    status: parseStatusBasis(parts.status),
    vendors: idList(parts.vendors),
    categories: idList(parts.categories),
    items: idList(parts.items),
    breakdownBy: dimension(parts.breakdownBy, "category"),
    compareBy: dimension(parts.compareBy, "item"),
  };
}

/**
 * From the page's search params. The singular names (vendor, category, item)
 * repeat, arriving as a string for one value and an array for several; `fy`
 * is the fiscal-year parameter from before #22, still honoured for old links.
 */
export function queryFromSearchParams(
  params: Record<string, string | string[] | undefined>,
  resolvedPeriod: string
): ReportQuery {
  return normaliseQuery({
    period: resolvedPeriod,
    section: params.section,
    status: params.status,
    vendors: params.vendor,
    categories: params.category,
    items: params.item,
    breakdownBy: params.breakdownBy,
    compareBy: params.compareBy,
  })!;
}

/** From a saved view's stored JSON — or a posted form's, which may be a string. */
export function queryFromSaved(raw: unknown): ReportQuery | null {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  return normaliseQuery(value as Record<string, unknown> as Parameters<typeof normaliseQuery>[0]);
}

/**
 * The page URL with one thing changed. Every control resolves to one of
 * these. Defaults are left out, so a plain view has a plain URL.
 */
export function buildHref(query: ReportQuery, patch: Partial<ReportQuery>): string {
  const next = { ...query, ...patch };
  const params = new URLSearchParams();

  params.set("period", next.period);
  if (next.section !== "overview") params.set("section", next.section);
  if ((next.status ?? "spend") !== "spend") params.set("status", next.status);
  if (next.breakdownBy !== "category") params.set("breakdownBy", next.breakdownBy);
  if (next.compareBy !== "item") params.set("compareBy", next.compareBy);
  for (const v of next.vendors) params.append("vendor", v);
  for (const c of next.categories) params.append("category", c);
  for (const i of next.items) params.append("item", i);

  return `${SPENDING_PATH}?${params.toString()}`;
}

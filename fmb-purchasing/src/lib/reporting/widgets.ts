/**
 * Home-page widgets as pieces of reports (reports overhaul, P2). Pure, and
 * safe for the browser: the builder dialog reads the catalogue from here.
 *
 * A widget used to be its own little report: a kind, a config with its own
 * idea of a period and filters, and a dispatcher of its own over the
 * aggregates. Two things computing the same figure could disagree, and a
 * widget could only ever show spending. Now a widget is
 *
 *   report  which report it is part of — a key in the registry
 *   query   that report page's own URL parameters: period, filters, basis
 *   view    which part of the page it shows
 *
 * and it is computed by the report's own loader (widget-data.ts), so it is
 * always a piece of the page it links to, and a report that gains a figure
 * can offer it as a widget.
 *
 * Widgets saved before this are read by `readWidget`, which turns the old
 * config into a spec as it goes; saving one writes the new shape.
 */

export type WidgetReport = "spend" | "money-out" | "exceptions";

export type WidgetView =
  // Spending
  | "spend-over-time"
  | "status-mix"
  | "ranked-chart"
  | "ranked-table"
  | "breakdown-over-time"
  | "compare-chart"
  | "compare-table"
  | "unit-cost-chart"
  | "unit-cost-table"
  | "figure-spend"
  | "figure-expenses"
  | "figure-average"
  | "figure-gst"
  // Money out
  | "paid-figure"
  | "paid-by-payee"
  | "waiting-figure"
  | "waiting-ages"
  | "review-figure"
  | "pipeline-timing"
  // Exceptions
  | "exceptions-figure"
  | "exceptions-summary";

/** What a view needs chosen, beyond its report. */
export type WidgetNeed = "period" | "filters" | "breakdownBy" | "compareBy" | "item";

export type WidgetViewDefinition = {
  report: WidgetReport;
  view: WidgetView;
  label: string;
  /** The report page's section the view is part of. */
  section: string;
  needs: WidgetNeed[];
};

const SPEND: WidgetNeed[] = ["period", "filters"];

export const WIDGET_VIEWS: WidgetViewDefinition[] = [
  { report: "spend", view: "spend-over-time", label: "Spend over time", section: "overview", needs: SPEND },
  { report: "spend", view: "status-mix", label: "Where it sits (by stage)", section: "overview", needs: SPEND },
  { report: "spend", view: "figure-spend", label: "Total spend", section: "overview", needs: SPEND },
  { report: "spend", view: "figure-expenses", label: "Number of expenses", section: "overview", needs: SPEND },
  { report: "spend", view: "figure-average", label: "Average expense", section: "overview", needs: SPEND },
  { report: "spend", view: "figure-gst", label: "GST", section: "overview", needs: SPEND },
  { report: "spend", view: "ranked-chart", label: "Spend by category, vendor or item (chart)", section: "breakdown", needs: [...SPEND, "breakdownBy"] },
  { report: "spend", view: "ranked-table", label: "Spend by category, vendor or item (table)", section: "breakdown", needs: [...SPEND, "breakdownBy"] },
  { report: "spend", view: "breakdown-over-time", label: "Breakdown over time", section: "breakdown", needs: [...SPEND, "breakdownBy"] },
  { report: "spend", view: "compare-chart", label: "Compare (chart)", section: "compare", needs: [...SPEND, "compareBy"] },
  { report: "spend", view: "compare-table", label: "Compare (table)", section: "compare", needs: [...SPEND, "compareBy"] },
  { report: "spend", view: "unit-cost-chart", label: "Unit cost trend (chart)", section: "unit-costs", needs: [...SPEND, "item"] },
  { report: "spend", view: "unit-cost-table", label: "Unit cost trend (table)", section: "unit-costs", needs: [...SPEND, "item"] },
  { report: "money-out", view: "paid-figure", label: "Paid", section: "paid", needs: ["period"] },
  { report: "money-out", view: "paid-by-payee", label: "Paid, by payee", section: "paid", needs: ["period"] },
  { report: "money-out", view: "waiting-figure", label: "Awaiting payment", section: "waiting", needs: [] },
  { report: "money-out", view: "waiting-ages", label: "How long payments have waited", section: "waiting", needs: [] },
  { report: "money-out", view: "review-figure", label: "Awaiting review", section: "pipeline", needs: [] },
  { report: "money-out", view: "pipeline-timing", label: "How long each step takes", section: "pipeline", needs: ["period"] },
  { report: "exceptions", view: "exceptions-figure", label: "Expenses with something to check", section: "exceptions", needs: ["period"] },
  { report: "exceptions", view: "exceptions-summary", label: "Exceptions by check", section: "exceptions", needs: ["period"] },
];

export const WIDGET_REPORT_LABEL: Record<WidgetReport, string> = {
  spend: "Spending",
  "money-out": "Money out",
  exceptions: "Exceptions",
};

export function widgetView(view: string | undefined): WidgetViewDefinition | undefined {
  return WIDGET_VIEWS.find((v) => v.view === view);
}

/** The report page's parameters, as its URL carries them. */
export type WidgetQuery = Record<string, string | string[]>;

export type WidgetSpec = { report: WidgetReport; view: WidgetView; query: WidgetQuery };

/** How a spec is stored in user_dashboard_widgets.config. */
export type StoredWidgetConfig = WidgetSpec & { version: 2 };

/** The parameters each report reads, and the ones that repeat. */
const PARAMS: Record<WidgetReport, { single: string[]; repeated: string[] }> = {
  spend: { single: ["period", "status", "breakdownBy", "compareBy"], repeated: ["vendor", "category", "item"] },
  "money-out": { single: ["period"], repeated: [] },
  exceptions: { single: ["period"], repeated: [] },
};

const MAX_VALUE = 200;
const MAX_VALUES = 200;

/**
 * A query holding only what the report reads, each value a plain short
 * string — whatever a stored row or a posted form sent. The section is left
 * out: the view decides it.
 */
export function cleanQuery(report: WidgetReport, raw: unknown): WidgetQuery {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ok = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX_VALUE;
  const out: WidgetQuery = {};
  for (const key of PARAMS[report].single) {
    const v = Array.isArray(source[key]) ? (source[key] as unknown[])[0] : source[key];
    if (ok(v)) out[key] = v;
  }
  for (const key of PARAMS[report].repeated) {
    const v = source[key];
    const list = (Array.isArray(v) ? v : v == null ? [] : [v]).filter(ok).slice(0, MAX_VALUES);
    if (list.length > 0) out[key] = list;
  }
  return out;
}

/** A spec from anything that claims to be one; null when it is not. */
export function specFrom(raw: unknown): WidgetSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const def = widgetView(r.view as string);
  if (!def || def.report !== r.report) return null;
  return { report: def.report, view: def.view, query: cleanQuery(def.report, r.query) };
}

/* ------------------------------------------------------------------ */
/* Widgets saved before the registry                                   */
/* ------------------------------------------------------------------ */

/** The config every widget was saved with before this. Read only. */
export type LegacyWidgetConfig = {
  period?: string;
  /** The fiscal year widgets saved before #22 carry instead of a period. */
  fy?: number;
  /** A month (YYYY-MM) — only on widgets saved before #22. */
  month?: string | null;
  vendorIds?: string[];
  categoryIds?: string[];
  itemIds?: string[];
  dimension?: string;
  compareBy?: string;
  compareSubjectIds?: string[];
  itemId?: string;
  itemLabel?: string;
  statMetric?: string;
};

const LEGACY_FIGURE: Record<string, WidgetView> = {
  spend: "figure-spend",
  expenseCount: "figure-expenses",
  averageExpense: "figure-average",
  gst: "figure-gst",
};

/**
 * An old widget as a spec. The period it showed is kept: a pre-#22 fiscal
 * year becomes that Hijri year, and a single month becomes that calendar
 * month. The filters become the Spending page's, so the widget now shows
 * exactly what Reports shows for them.
 */
export function legacySpec(kind: string, config: LegacyWidgetConfig): WidgetSpec | null {
  const view: WidgetView | undefined = kind === "stat-tile" ? LEGACY_FIGURE[config.statMetric ?? "spend"] : widgetView(kind)?.view;
  if (!view || widgetView(view)?.report !== "spend") return null;

  const month = /^(\d{4})-(\d{2})$/.exec(config.month ?? "");
  const period = month
    ? `cy${month[1]}-m${Number(month[2])}`
    : (config.period ?? (config.fy != null ? `h${config.fy}` : "h-current"));

  const vendor = [...(config.vendorIds ?? [])];
  const category = [...(config.categoryIds ?? [])];
  let item = [...(config.itemIds ?? [])];

  const query: Record<string, unknown> = { period };
  if (view === "ranked-chart" || view === "ranked-table" || view === "breakdown-over-time") {
    query.breakdownBy = config.dimension ?? "category";
  }
  if (view === "compare-chart" || view === "compare-table") {
    const by = config.compareBy ?? "item";
    query.compareBy = by;
    // The old builder saved the picked subjects twice — as the filter and as
    // the subjects. The page picks subjects from the filter; keep one copy.
    const chosen = config.compareSubjectIds ?? [];
    const list = by === "vendor" ? vendor : by === "category" ? category : item;
    if (list.length === 0) list.push(...chosen);
  }
  if (view === "unit-cost-chart" || view === "unit-cost-table") {
    // It showed one item's purchases; the page shows the items filtered to.
    item = config.itemId ? [config.itemId] : item;
  }
  query.vendor = vendor;
  query.category = category;
  query.item = item;

  return { report: "spend", view, query: cleanQuery("spend", query) };
}

/**
 * A stored widget row as a spec, whichever shape it was saved in. Null for a
 * row that is neither — shown as nothing rather than as a wrong figure.
 */
export function readWidget(row: { kind: string; config: unknown }): WidgetSpec | null {
  const config = row.config && typeof row.config === "object" ? (row.config as Record<string, unknown>) : {};
  if (config.version === 2) return specFrom(config);
  return legacySpec(row.kind, config as LegacyWidgetConfig);
}

/** What is written back for a spec. `kind` keeps the view, for anyone reading the table. */
export function storedWidget(spec: WidgetSpec): { kind: string; config: StoredWidgetConfig } {
  return { kind: spec.view, config: { version: 2, ...spec } };
}

/* ------------------------------------------------------------------ */
/* Where a widget leads                                                */
/* ------------------------------------------------------------------ */

/** The report page's parameters for a widget: its query, with its view's section. */
export function widgetParams(spec: WidgetSpec): Record<string, string | string[]> {
  const def = widgetView(spec.view)!;
  const params: Record<string, string | string[]> = { ...spec.query };
  if (spec.report === "spend" && def.section !== "overview") params.section = def.section;
  if (spec.report === "money-out") params.section = def.section;
  // A view that is as of today has no period to carry.
  if (!def.needs.includes("period")) delete params.period;
  return params;
}

/** The widget's page, open on the same period, filters and section. */
export function widgetHref(spec: WidgetSpec, path: string): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(widgetParams(spec))) {
    for (const v of Array.isArray(value) ? value : [value]) search.append(key, v);
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/** How many filters a widget narrows by. */
export function filterCount(spec: WidgetSpec): number {
  return ["vendor", "category", "item"].reduce((n, k) => {
    const v = spec.query[k];
    return n + (Array.isArray(v) ? v.length : v ? 1 : 0);
  }, 0);
}

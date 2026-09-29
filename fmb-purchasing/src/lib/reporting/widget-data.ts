import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePeriod } from "@/lib/periods";
import type { Bucket, Comparison, Dimension, MonthBreakdown } from "./aggregate.ts";
import { loadExceptionsView, type ExceptionsView } from "./exceptions-data.ts";
import { loadMoneyOutView, type MoneyOutView } from "./money-out-view.ts";
import type { Timing } from "./money-out.ts";
import { loadSpendView, type SpendView } from "./spend-view.ts";
import type { PerUnitRow } from "./unit-costs.ts";
import { filterCount, widgetParams, widgetView, type WidgetSpec, type WidgetView } from "./widgets.ts";

/**
 * A widget's figures: its report loaded by the report's own loader, from the
 * page's own parameters, and the one piece it shows taken out. Nothing here
 * computes a figure the page doesn't.
 */

export type WidgetData =
  | { kind: "spend-over-time"; monthly: Bucket[] }
  | { kind: "status-mix"; statusMix: Bucket[] }
  | { kind: "ranked-chart" | "ranked-table"; ranked: Bucket[]; dimension: Dimension }
  | { kind: "breakdown-over-time"; breakdown: MonthBreakdown; dimension: Dimension }
  | { kind: "compare-chart" | "compare-table"; comparison: Comparison; dimension: Dimension }
  | { kind: "unit-cost-chart" | "unit-cost-table"; rows: PerUnitRow[]; itemLabel: string }
  /** One figure, with what it is and a line under it. */
  | { kind: "figure"; label: string; value: number; format: "money" | "count"; caption: string }
  /** A small table, its cells already in words. */
  | { kind: "table"; columns: { label: string; numeric?: boolean }[]; rows: string[][]; total?: string[]; empty: string };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const days = (n: number | null) => (n === null ? "—" : String(n));

/* ------------------------------------------------------------------ */
/* Taking a widget out of its report — pure                            */
/* ------------------------------------------------------------------ */

export function spendWidget(view: WidgetView, page: SpendView): WidgetData | null {
  const { report } = page;
  const s = report.section;
  const now = report.now;
  const caption = plural(now.expenseCount, "expense");
  switch (view) {
    case "spend-over-time":
      return { kind: view, monthly: report.monthly };
    case "status-mix":
      return s.key === "overview" ? { kind: view, statusMix: s.statusMix } : null;
    case "ranked-chart":
    case "ranked-table":
      return s.key === "breakdown" ? { kind: view, ranked: s.ranked, dimension: s.dimension } : null;
    case "breakdown-over-time":
      return s.key === "breakdown" ? { kind: view, breakdown: s.overTime, dimension: s.dimension } : null;
    case "compare-chart":
    case "compare-table":
      return s.key === "compare" ? { kind: view, comparison: s.comparison, dimension: s.dimension } : null;
    case "unit-cost-chart":
    case "unit-cost-table": {
      if (s.key !== "unit-costs") return null;
      const chosen = page.query.items.map((id) => page.options.items.find((o) => o.value === id)?.label ?? id);
      return { kind: view, rows: s.rows, itemLabel: chosen.join(", ") || s.rows[0]?.groupName || "Item" };
    }
    case "figure-spend":
      return { kind: "figure", label: "Total spend", value: now.spend, format: "money", caption };
    case "figure-expenses":
      return { kind: "figure", label: "Expenses", value: now.expenseCount, format: "count", caption: money(now.spend) };
    case "figure-average":
      return { kind: "figure", label: "Average expense", value: now.averageExpense, format: "money", caption };
    case "figure-gst":
      return { kind: "figure", label: "GST", value: now.gst, format: "money", caption };
    default:
      return null;
  }
}

export function moneyOutWidget(view: WidgetView, page: MoneyOutView): WidgetData | null {
  if (page.section === "paid") {
    const r = page.report;
    if (view === "paid-figure") {
      const unconfirmed = r.unconfirmed.count ? ` · ${money(r.unconfirmed.amount)} not yet on a statement` : "";
      return { kind: "figure", label: "Paid", value: r.total, format: "money", caption: `${plural(r.transfers.length, "transfer")}${unconfirmed}` };
    }
    if (view === "paid-by-payee") {
      return {
        kind: "table",
        columns: [{ label: "Payee" }, { label: "Transfers", numeric: true }, { label: "Paid", numeric: true }],
        rows: r.byPayee.slice(0, 8).map((p) => [p.payee, String(p.transfers), money(p.amount)]),
        total: ["Total", String(r.transfers.length), money(r.total)],
        empty: "Nothing paid in this period.",
      };
    }
  }
  if (page.section === "waiting") {
    const w = page.report;
    if (view === "waiting-figure") {
      return {
        kind: "figure",
        label: "Awaiting payment",
        value: w.amount,
        format: "money",
        caption: w.count ? `${plural(w.count, "expense")} · oldest approved ${plural(w.oldestDays ?? 0, "day")} ago` : "Nothing waiting",
      };
    }
    if (view === "waiting-ages") {
      return {
        kind: "table",
        columns: [{ label: "Waiting" }, { label: "Expenses", numeric: true }, { label: "Amount", numeric: true }],
        rows: w.count ? w.bands.map((b) => [b.label, String(b.count), money(b.amount)]) : [],
        total: ["Total", String(w.count), money(w.amount)],
        empty: "Nothing is waiting to be paid.",
      };
    }
  }
  if (page.section === "pipeline") {
    const p = page.report;
    if (view === "review-figure") {
      const w = p.awaitingReview;
      return {
        kind: "figure",
        label: "Awaiting review",
        value: w.amount,
        format: "money",
        caption: w.count ? `${plural(w.count, "expense")} · oldest submitted ${plural(w.oldestDays ?? 0, "day")} ago` : "Nothing waiting",
      };
    }
    if (view === "pipeline-timing") {
      const row = (step: string, t: Timing) => [step, String(t.count), days(t.median), days(t.slowest)];
      const rows = [
        row("Submitted to decided", p.submitToDecision),
        row("Approved to paid", p.decisionToPayment),
        row("Submitted to paid", p.submitToPayment),
      ];
      return {
        kind: "table",
        columns: [{ label: "Days" }, { label: "Expenses", numeric: true }, { label: "Median", numeric: true }, { label: "Slowest", numeric: true }],
        rows: rows.some((r) => r[1] !== "0") ? rows : [],
        empty: "Nothing decided or paid in this period.",
      };
    }
  }
  return null;
}

export function exceptionsWidget(view: WidgetView, page: ExceptionsView): WidgetData | null {
  const r = page.report;
  if (view === "exceptions-figure") {
    return {
      kind: "figure",
      label: "Expenses with something to check",
      value: r.flaggedExpenses,
      format: "count",
      caption: `of ${r.expenseCount} · ${money(r.flaggedSpend)} of ${money(r.spend)}`,
    };
  }
  if (view === "exceptions-summary") {
    const found = r.groups.filter((g) => g.rows.length > 0);
    return {
      kind: "table",
      columns: [{ label: "Check" }, { label: "Items", numeric: true }, { label: "Amount", numeric: true }],
      rows: found.map((g) => [g.heading, String(g.rows.length), money(g.amount)]),
      empty: "Nothing to check in this period.",
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

export type ComputedWidget = {
  data: WidgetData | null;
  /** Period and filters in words, for under the widget's title. */
  summary: string;
};

/**
 * Widgets computed together: widgets on the same page of the same report,
 * with the same parameters, share one load of it.
 */
export async function computeWidgets(admin: SupabaseClient, specs: WidgetSpec[], today: string): Promise<ComputedWidget[]> {
  const loads = new Map<string, Promise<unknown>>();
  const load = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    if (!loads.has(key)) loads.set(key, fn());
    return loads.get(key)! as Promise<T>;
  };

  return Promise.all(
    specs.map(async (spec): Promise<ComputedWidget> => {
      const params = widgetParams(spec);
      const key = `${spec.report}:${JSON.stringify(params)}`;
      const def = widgetView(spec.view)!;
      const periodWords = def.needs.includes("period") ? parsePeriod(params.period as string | undefined, today).label : "As of today";
      const filters = filterCount(spec);
      const summary = filters ? `${periodWords} · ${plural(filters, "filter")}` : periodWords;

      let data: WidgetData | null = null;
      if (spec.report === "spend") data = spendWidget(spec.view, await load(key, () => loadSpendView(params, today)));
      if (spec.report === "money-out") data = moneyOutWidget(spec.view, await load(key, () => loadMoneyOutView(admin, params, today)));
      if (spec.report === "exceptions") data = exceptionsWidget(spec.view, await load(key, () => loadExceptionsView(admin, params, today)));
      return { data, summary };
    })
  );
}

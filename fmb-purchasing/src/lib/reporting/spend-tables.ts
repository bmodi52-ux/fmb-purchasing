/**
 * The Reports page's sections as downloadable tables — the same figures the
 * page draws (spend-report.ts), laid out for a spreadsheet. Pure.
 */

import type { Bucket, Dimension, Totals } from "./aggregate.ts";
import type { SpendReport } from "./spend-report.ts";
import type { ReportTable } from "./tables.ts";

const DIMENSION_LABEL: Record<Dimension, { one: string; many: string; counted: string }> = {
  category: { one: "Category", many: "Categories", counted: "Lines" },
  vendor: { one: "Vendor", many: "Vendors", counted: "Expenses" },
  item: { one: "Item", many: "Items", counted: "Lines" },
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** Buckets as a table with a totals row: label, how many, spend, GST, and optionally share. */
function bucketTable(title: string, first: string, counted: string, buckets: Bucket[], withShare: boolean): ReportTable {
  const total = cents(buckets.reduce((s, b) => s + b.spend, 0));
  return {
    title,
    columns: [
      { key: "label", label: first, kind: "text" },
      { key: "count", label: counted, kind: "count" },
      { key: "spend", label: "Total", kind: "money" },
      { key: "gst", label: "GST", kind: "money" },
      ...(withShare ? [{ key: "share", label: "Share", kind: "percent" as const }] : []),
    ],
    rows: buckets.map((b) => ({
      label: b.label,
      count: b.count,
      spend: b.spend,
      gst: cents(b.gst),
      ...(withShare ? { share: total > 0 ? b.spend / total : null } : {}),
    })),
    totals: {
      label: "Total",
      count: buckets.reduce((s, b) => s + b.count, 0),
      spend: total,
      gst: cents(buckets.reduce((s, b) => s + b.gst, 0)),
      ...(withShare ? { share: total > 0 ? 1 : null } : {}),
    },
  };
}

/**
 * The headline figures. Excel formats a column, not a cell, so amounts and
 * counts sit in columns of their own and each row fills the pair it needs.
 */
function headlineTable(now: Totals, before: Totals | null, periodLabel: string, previousLabel: string): ReportTable {
  const row = (measure: string, value: number, kind: "money" | "count", previous: number | null) => ({
    measure,
    [kind === "money" ? "amount" : "count"]: value,
    [kind === "money" ? "previousAmount" : "previousCount"]: previous,
    change: previous ? (value - previous) / previous : null,
  });
  return {
    title: "Headline",
    columns: [
      { key: "measure", label: "Measure", kind: "text" },
      { key: "amount", label: periodLabel, kind: "money" },
      { key: "count", label: `${periodLabel} (count)`, kind: "count" },
      { key: "previousAmount", label: previousLabel, kind: "money" },
      { key: "previousCount", label: `${previousLabel} (count)`, kind: "count" },
      { key: "change", label: "Change", kind: "percent" },
    ],
    rows: [
      row("Total spend", now.spend, "money", before?.spend ?? null),
      row("GST", now.gst, "money", before?.gst ?? null),
      row("Expenses", now.expenseCount, "count", before?.expenseCount ?? null),
      row("Lines", now.lineCount, "count", before?.lineCount ?? null),
      row("Average expense", cents(now.averageExpense), "money", before ? cents(before.averageExpense) : null),
    ],
  };
}

/** The section on screen as tables — its main table first, since a CSV holds only that one — then the headline. */
export function spendReportTables(report: SpendReport, periodLabel: string, previousLabel: string): ReportTable[] {
  const s = report.section;
  const main: ReportTable[] = [];

  if (s.key === "overview") {
    main.push(bucketTable("Spend by month", "Month", "Expenses", report.monthly, false));
    main.push(bucketTable("By stage", "Stage", "Expenses", s.statusMix, true));
  } else if (s.key === "breakdown") {
    const d = DIMENSION_LABEL[s.dimension];
    main.push(bucketTable(`Spend by ${d.one.toLowerCase()}`, d.one, d.counted, s.ranked, true));
    main.push({
      title: `${d.many} by month`,
      columns: [
        { key: "month", label: "Month", kind: "text" },
        ...s.overTime.series.map((series) => ({ key: series.key, label: series.label, kind: "money" as const })),
      ],
      rows: s.overTime.months.map((m, i) => ({
        month: m.label,
        ...Object.fromEntries(s.overTime.series.map((series) => [series.key, series.values[i]])),
      })),
      totals: { month: "Total", ...Object.fromEntries(s.overTime.series.map((series) => [series.key, series.total])) },
    });
  } else if (s.key === "compare") {
    const d = DIMENSION_LABEL[s.dimension];
    main.push({
      title: `Compare ${d.many.toLowerCase()}`,
      columns: [
        { key: "month", label: "Month", kind: "text" },
        ...s.comparison.subjects.map((subject) => ({ key: subject.key, label: subject.label, kind: "money" as const })),
      ],
      rows: s.comparison.months.map((m, i) => ({
        month: m.label,
        ...Object.fromEntries(s.comparison.subjects.map((subject) => [subject.key, subject.values[i]])),
      })),
      totals: {
        month: "Total",
        ...Object.fromEntries(s.comparison.subjects.map((subject) => [subject.key, subject.total])),
      },
    });
  } else if (s.key === "transactions") {
    main.push({
      title: "Transactions",
      columns: [
        { key: "date", label: "Date", kind: "date" },
        { key: "entry", label: "Entry", kind: "text" },
        { key: "vendor", label: "Vendor", kind: "text" },
        { key: "item", label: "Item", kind: "text" },
        { key: "category", label: "Category", kind: "text" },
        { key: "status", label: "Status", kind: "text" },
        { key: "amount", label: "Amount", kind: "money" },
        { key: "gst", label: "GST", kind: "money" },
      ],
      rows: s.rows.map((r) => ({ ...r, entry: r.entry ?? "" })),
      totals: {
        date: null,
        entry: "Total",
        amount: cents(s.rows.reduce((sum, r) => sum + r.amount, 0)),
        gst: cents(s.rows.reduce((sum, r) => sum + r.gst, 0)),
      },
    });
  } else {
    main.push({
      title: "Unit costs",
      columns: [
        { key: "item", label: "Item", kind: "text" },
        { key: "vendor", label: "Vendor", kind: "text" },
        { key: "date", label: "Date", kind: "date" },
        { key: "quantity", label: "Quantity", kind: "number" },
        { key: "unit", label: "Unit", kind: "text" },
        { key: "perPack", label: "Per pack", kind: "money" },
        { key: "perUnit", label: "Per unit", kind: "money" },
        { key: "doubt", label: "Pack in doubt", kind: "text" },
      ],
      rows: s.rows.map((r) => ({
        item: r.groupName,
        vendor: r.vendorName,
        date: r.receiptDate,
        quantity: r.normalizedQuantity,
        unit: r.normalizedUnit,
        perPack: r.perPack == null ? null : cents(r.perPack),
        // A per-unit figure resting on a pack nobody believes is left blank,
        // as it is left out of the trend on screen.
        perUnit: r.disputed ? null : r.perUnit,
        doubt: r.disputed ? "yes" : "",
      })),
    });
  }

  return [...main, headlineTable(report.now, report.before, periodLabel, previousLabel)];
}

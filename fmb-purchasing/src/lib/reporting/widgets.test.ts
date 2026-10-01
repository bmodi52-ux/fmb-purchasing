import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spendViewFromLedger } from "./spend-view.ts";
import { spendWidget, type WidgetData } from "./widget-data.ts";
import {
  cleanQuery,
  filterCount,
  readWidget,
  specFrom,
  storedWidget,
  widgetHref,
  widgetParams,
  type LegacyWidgetConfig,
} from "./widgets.ts";
import { hijriMonthOf } from "@/lib/periods";
import type { ExpenseRecord, LineRecord } from "./aggregate.ts";
import type { Ledger, PaidCostRow } from "./ledger-rows.ts";

const expenses: ExpenseRecord[] = [
  {
    id: "e1",
    expenseNumber: "E-0001",
    vendorId: "v-butcher",
    vendorName: "Madani Mart",
    status: "paid",
    receiptDate: "2026-05-05",
    createdAt: "2026-05-06T10:00:00Z",
    reportDate: "2026-05-05",
    total: 1320,
    gst: 120,
  },
  {
    id: "e2",
    expenseNumber: "E-0002",
    vendorId: "v-costco",
    vendorName: "Costco",
    status: "submitted",
    receiptDate: "2026-07-20",
    createdAt: "2026-07-21T10:00:00Z",
    reportDate: "2026-07-20",
    total: 300,
    gst: 27.27,
  },
  {
    id: "e-old",
    expenseNumber: "E-0000",
    vendorId: "v-costco",
    vendorName: "Costco",
    status: "paid",
    receiptDate: "2025-05-05",
    createdAt: "2025-05-06T10:00:00Z",
    reportDate: "2025-05-05",
    total: 999,
    gst: 90,
  },
];

const lines: LineRecord[] = [
  {
    expenseId: "e1",
    categoryId: "c-meat",
    categoryName: "Meat & Poultry",
    itemId: "i-mutton",
    itemName: "Mutton",
    lineTotal: 1320,
    gst: 0,
    gstApportioned: false,
    quantity: 80,
  },
  {
    expenseId: "e2",
    categoryId: "c-bakery",
    categoryName: "Bakery",
    itemId: "i-rolls",
    itemName: "Dinner Rolls",
    lineTotal: 300,
    gst: 0,
    gstApportioned: false,
    quantity: 10,
  },
  {
    expenseId: "e-old",
    categoryId: "c-meat",
    categoryName: "Meat & Poultry",
    itemId: "i-mutton",
    itemName: "Mutton",
    lineTotal: 999,
    gst: 0,
    gstApportioned: false,
    quantity: 60,
  },
];

const paidCosts: PaidCostRow[] = [
  {
    item_id: "i-mutton",
    item_name: "Mutton",
    expense_id: "e1",
    receipt_date: "2026-05-05",
    base_quantity: 80,
    base_unit_code: "kg",
    cost_per_base_unit: 16.5,
    line_total: 1320,
    normalized_quantity: 4,
    sold_loose: false,
  },
  {
    item_id: "i-rolls",
    item_name: "Dinner Rolls",
    expense_id: "e2",
    receipt_date: "2026-07-20",
    base_quantity: 10,
    base_unit_code: "ea",
    cost_per_base_unit: 9.99,
    line_total: 99.9,
    normalized_quantity: 10,
    sold_loose: false,
  },
  {
    // Same item, but on an expense from a fiscal year this widget isn't
    // scoped to — must not leak into a 1447-scoped widget's rows.
    item_id: "i-mutton",
    item_name: "Mutton",
    expense_id: "e-old",
    receipt_date: "2025-05-05",
    base_quantity: 60,
    base_unit_code: "kg",
    cost_per_base_unit: 16.65,
    line_total: 999,
    normalized_quantity: 3,
    sold_loose: false,
  },
];

const raw = {
  expenses: expenses as Ledger["expenses"],
  lines: lines as Ledger["lines"],
  unitCosts: paidCosts,
};

const TODAY = "2026-09-11";

const BASE: LegacyWidgetConfig = {
  fy: 1447,
  month: null,
  vendorIds: [],
  categoryIds: [],
  itemIds: [],
};

/** An old widget, read as it now is and computed by the Spending page's own view. */
function oldWidget(kind: string, config: LegacyWidgetConfig): WidgetData {
  const spec = readWidget({ kind, config });
  assert.ok(spec, `${kind} should convert`);
  const data = spendWidget(spec.view, spendViewFromLedger(widgetParams(spec), TODAY, raw));
  assert.ok(data, `${kind} should compute`);
  return data;
}

describe("widgets saved before the registry, computed through Reports", () => {
  test("a fiscal year reads as that Hijri year, and a new period works the same", () => {
    const legacy = oldWidget("stat-tile", BASE);
    const hijri = oldWidget("stat-tile", { ...BASE, fy: undefined, period: "h1447" });
    assert.deepEqual(legacy, hijri);
    // The 2025-26 financial year holds only the May 2026 purchase.
    const fy = oldWidget("stat-tile", { ...BASE, fy: undefined, period: "au2025" });
    assert.ok(fy.kind === "figure");
    assert.equal(fy.value, 1320);
  });

  test("spend-over-time buckets by month, scoped to the widget's year", () => {
    const data = oldWidget("spend-over-time", BASE);
    assert.ok(data.kind === "spend-over-time");
    // Only e1 (May) and e2 (July) belong to 1447 — e-old (1446) must not add
    // a bucket. A Hijri year's widget groups by Hijri month, as Reports does.
    assert.deepEqual(
      data.monthly.map((m) => m.key),
      [hijriMonthOf("2026-05-05").key, hijriMonthOf("2026-07-20").key]
    );
  });

  test("a widget on a financial year keeps Gregorian months", () => {
    const data = oldWidget("spend-over-time", { ...BASE, fy: undefined, period: "au2026" });
    assert.ok(data.kind === "spend-over-time");
    assert.deepEqual(data.monthly.map((m) => m.key), ["2026-07"]);
  });

  test("a single saved month becomes that calendar month", () => {
    const spec = readWidget({ kind: "spend-over-time", config: { ...BASE, month: "2026-07" } })!;
    assert.equal(spec.query.period, "cy2026-m7");
    const data = oldWidget("spend-over-time", { ...BASE, month: "2026-07" });
    assert.ok(data.kind === "spend-over-time");
    assert.deepEqual(data.monthly.map((m) => [m.key, m.spend]), [["2026-07", 300]]);
  });

  test("ranked-chart keeps its dimension", () => {
    const data = oldWidget("ranked-chart", { ...BASE, dimension: "vendor" });
    assert.ok(data.kind === "ranked-chart");
    assert.equal(data.dimension, "vendor");
    assert.equal(data.ranked.find((b) => b.label === "Costco")?.spend, 300);
  });

  test("stat-tile defaults to spend and matches the period's totals", () => {
    const data = oldWidget("stat-tile", BASE);
    assert.ok(data.kind === "figure");
    assert.equal(data.label, "Total spend");
    assert.equal(data.value, 1620);
    assert.equal(data.caption, "2 expenses");
  });

  test("stat-tile's other figures become views of their own", () => {
    assert.equal(readWidget({ kind: "stat-tile", config: { ...BASE, statMetric: "gst" } })!.view, "figure-gst");
    assert.equal(readWidget({ kind: "stat-tile", config: { ...BASE, statMetric: "expenseCount" } })!.view, "figure-expenses");
    const avg = oldWidget("stat-tile", { ...BASE, statMetric: "averageExpense" });
    assert.ok(avg.kind === "figure");
    assert.equal(avg.value, 810);
  });

  test("a unit-cost widget becomes the item filter, scoped to the widget's year", () => {
    const spec = readWidget({ kind: "unit-cost-chart", config: { ...BASE, itemId: "i-mutton", itemLabel: "Mutton" } })!;
    assert.deepEqual(spec.query.item, ["i-mutton"]);
    const data = oldWidget("unit-cost-chart", { ...BASE, itemId: "i-mutton", itemLabel: "Mutton" });
    assert.ok(data.kind === "unit-cost-chart");
    // Only the 1447 purchase — the 1446 one must not leak in.
    assert.equal(data.rows.length, 1);
    assert.equal(data.rows[0].vendorName, "Madani Mart");
    assert.equal(data.rows[0].perUnit, 16.5);
    assert.equal(data.itemLabel, "Mutton");
  });

  test("a unit-cost widget still respects its vendor filter", () => {
    const data = oldWidget("unit-cost-chart", { ...BASE, itemId: "i-mutton", vendorIds: ["v-costco"] });
    assert.ok(data.kind === "unit-cost-chart");
    // Madani Mart's mutton is filtered out by the vendor, so nothing is left.
    assert.equal(data.rows.length, 0);
  });

  test("compare falls back to the top spenders when nothing is chosen", () => {
    const data = oldWidget("compare-chart", { ...BASE, compareBy: "category" });
    assert.ok(data.kind === "compare-chart");
    assert.equal(data.comparison.subjects.length, 2);
    assert.equal(data.comparison.subjects[0].label, "Meat & Poultry");
  });

  test("compare subjects saved apart from the filter become the filter", () => {
    const spec = readWidget({
      kind: "compare-table",
      config: { ...BASE, compareBy: "vendor", compareSubjectIds: ["v-costco"] },
    })!;
    assert.deepEqual(spec.query.vendor, ["v-costco"]);
    assert.equal(spec.query.compareBy, "vendor");
  });

  test("a kind that never existed, or a row with no config, reads as nothing", () => {
    assert.equal(readWidget({ kind: "pie-chart", config: BASE }), null);
    assert.ok(readWidget({ kind: "status-mix", config: null }));
    assert.equal(readWidget({ kind: "status-mix", config: null })!.query.period, "h-current");
  });
});

describe("widget specs", () => {
  test("a stored spec reads back as itself", () => {
    const spec = { report: "money-out" as const, view: "paid-figure" as const, query: { period: "au-current" } };
    const stored = storedWidget(spec);
    assert.equal(stored.kind, "paid-figure");
    assert.deepEqual(readWidget(stored), spec);
  });

  test("a spec keeps only what its report reads", () => {
    assert.deepEqual(cleanQuery("exceptions", { period: "h1447", vendor: ["x"], section: "paid" }), { period: "h1447" });
    assert.deepEqual(cleanQuery("spend", { period: "h1447", vendor: "v1", item: ["", "i1"], junk: 1 }), {
      period: "h1447",
      vendor: ["v1"],
      item: ["i1"],
    });
    // A view claimed for the wrong report is refused.
    assert.equal(specFrom({ report: "spend", view: "paid-figure", query: {} }), null);
  });

  test("a widget leads to its report, open where it was", () => {
    const ranked = readWidget({ kind: "ranked-table", config: { ...BASE, dimension: "vendor", vendorIds: ["v1"] } })!;
    assert.equal(widgetHref(ranked, "/reports/spending"), "/reports/spending?period=h1447&breakdownBy=vendor&vendor=v1&section=breakdown");
    assert.equal(filterCount(ranked), 1);
    // A view as of today carries no period.
    const waiting = { report: "money-out" as const, view: "waiting-figure" as const, query: { period: "h1447" } };
    assert.equal(widgetHref(waiting, "/reports/money-out"), "/reports/money-out?section=waiting");
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeWidgetData, type WidgetConfig } from "./dashboard-widgets.ts";
import type { ExpenseRecord, LineRecord } from "./aggregate.ts";
import type { PaidCostRow, ReportRawData } from "./data.ts";

const expenses: ExpenseRecord[] = [
  {
    id: "e1",
    expenseNumber: "E-0001",
    vendorId: "v-butcher",
    vendorName: "Madani Mart",
    status: "paid",
    receiptDate: "2026-05-05",
    createdAt: "2026-05-06T10:00:00Z",
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
    quantity: 80,
  },
  {
    expenseId: "e2",
    categoryId: "c-bakery",
    categoryName: "Bakery",
    itemId: "i-rolls",
    itemName: "Dinner Rolls",
    lineTotal: 300,
    quantity: 10,
  },
  {
    expenseId: "e-old",
    categoryId: "c-meat",
    categoryName: "Meat & Poultry",
    itemId: "i-mutton",
    itemName: "Mutton",
    lineTotal: 999,
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
  },
  {
    item_id: "i-rolls",
    item_name: "Dinner Rolls",
    expense_id: "e2",
    receipt_date: "2026-07-20",
    base_quantity: 10,
    base_unit_code: "ea",
    cost_per_base_unit: 9.99,
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
  },
];

const fyOf = new Map<string, number>([
  ["e1", 1447],
  ["e2", 1447],
  ["e-old", 1446],
]);

const raw: ReportRawData = { allExpenses: expenses, allLines: lines, paidCosts, fyOf };

const BASE_CONFIG: WidgetConfig = {
  fy: 1447,
  month: null,
  vendorIds: [],
  categoryIds: [],
  itemIds: [],
};

describe("computeWidgetData", () => {
  test("spend-over-time buckets by month, scoped to the widget's fiscal year", () => {
    const data = computeWidgetData("spend-over-time", BASE_CONFIG, raw);
    assert.equal(data.kind, "spend-over-time");
    if (data.kind !== "spend-over-time") return;
    // Only e1 (May) and e2 (July) belong to fy 1447 — e-old (fy 1446) must
    // not contribute a third bucket even though its date also falls in May.
    assert.deepEqual(
      data.monthly.map((m) => m.key),
      ["2026-05", "2026-07"]
    );
  });

  test("ranked-chart respects the configured dimension", () => {
    const data = computeWidgetData(
      "ranked-chart",
      { ...BASE_CONFIG, dimension: "vendor" },
      raw
    );
    assert.equal(data.kind, "ranked-chart");
    if (data.kind !== "ranked-chart") return;
    assert.equal(data.dimension, "vendor");
    const costco = data.ranked.find((b) => b.label === "Costco");
    assert.ok(costco);
    assert.equal(costco?.spend, 300);
  });

  test("stat-tile defaults to spend and matches totals for the slice", () => {
    const data = computeWidgetData("stat-tile", BASE_CONFIG, raw);
    assert.equal(data.kind, "stat-tile");
    if (data.kind !== "stat-tile") return;
    assert.equal(data.metric, "spend");
    assert.equal(data.totals.spend, 1620);
    assert.equal(data.totals.expenseCount, 2);
  });

  test("unit-cost-chart scopes rows to the chosen item and the widget's fiscal year", () => {
    const data = computeWidgetData(
      "unit-cost-chart",
      { ...BASE_CONFIG, itemId: "i-mutton", itemLabel: "Mutton" },
      raw
    );
    assert.equal(data.kind, "unit-cost-chart");
    if (data.kind !== "unit-cost-chart") return;
    // Only the 1447 purchase — the 1446 one (different expense id, same
    // item) must not leak in just because the item matches.
    assert.equal(data.rows.length, 1);
    assert.equal(data.rows[0].vendorName, "Madani Mart");
    assert.equal(data.rows[0].perUnit, 16.5);
  });

  test("unit-cost-chart also respects the widget's own vendor/category/item filters", () => {
    const data = computeWidgetData(
      "unit-cost-chart",
      { ...BASE_CONFIG, itemId: "i-mutton", vendorIds: ["v-costco"] },
      raw
    );
    assert.equal(data.kind, "unit-cost-chart");
    if (data.kind !== "unit-cost-chart") return;
    // Madani Mart's mutton purchase is filtered out by the vendor filter,
    // so no rows survive even though the item still exists in the year.
    assert.equal(data.rows.length, 0);
  });

  test("compare-chart falls back to the top spenders when no subjects are chosen", () => {
    const data = computeWidgetData(
      "compare-chart",
      { ...BASE_CONFIG, compareBy: "category" },
      raw
    );
    assert.equal(data.kind, "compare-chart");
    if (data.kind !== "compare-chart") return;
    assert.equal(data.comparison.subjects.length, 2);
    assert.equal(data.comparison.subjects[0].label, "Meat & Poultry");
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeSpendReport, forScreen, TRANSACTIONS_ON_SCREEN } from "./spend-report.ts";
import {
  applyFilters,
  byCategory,
  byMonth,
  byMonthBreakdown,
  byStatus,
  byVendor,
  compare,
  insights,
  totals,
  NO_FILTERS,
  type ExpenseRecord,
  type LineRecord,
} from "./aggregate.ts";
import { queryFromSearchParams } from "./query.ts";
import type { PaidCostRow } from "./ledger-rows.ts";

const expense = (id: string, vendor: string, status: string, reportDate: string, total: number) =>
  ({
    id,
    expenseNumber: id,
    vendorId: vendor,
    vendorName: vendor,
    status,
    receiptDate: reportDate,
    createdAt: `${reportDate}T01:00:00Z`,
    reportDate,
    total,
    gst: 0,
  }) as ExpenseRecord;

const line = (expenseId: string, categoryId: string, itemId: string | null, lineTotal: number): LineRecord => ({
  expenseId,
  categoryId,
  categoryName: categoryId,
  itemId,
  itemName: itemId ?? "loose",
  lineTotal,
  gst: 0,
  gstApportioned: false,
  quantity: 1,
});

const expenses = [
  expense("e1", "Madani", "paid", "2026-07-03", 300),
  expense("e2", "Costco", "approved", "2026-08-10", 200),
  expense("e3", "Costco", "submitted", "2026-08-20", 50),
];
const lines = [
  line("e1", "meat", "mutton", 300),
  line("e2", "dry", "rice", 150),
  line("e2", "meat", "mutton", 50),
  line("e3", "dry", null, 50),
];
const unitCosts: PaidCostRow[] = [
  {
    item_id: "mutton",
    item_name: "Mutton",
    expense_id: "e1",
    receipt_date: "2026-07-03",
    base_quantity: 20,
    base_unit_code: "kg",
    cost_per_base_unit: 15,
    line_total: 300,
    normalized_quantity: 2,
    sold_loose: false,
    pack_disagrees: false,
  },
];

const current = applyFilters(expenses, lines, NO_FILTERS);
const previous = applyFilters([expense("p1", "Madani", "paid", "2025-07-03", 400)], [line("p1", "meat", "mutton", 400)], NO_FILTERS);

function reportFor(params: Record<string, string>) {
  return computeSpendReport({
    current,
    previous,
    unitCosts,
    query: queryFromSearchParams(params, "au2026"),
    periodLabel: "FY 2026–27",
    previousLabel: "FY 2025–26",
  });
}

describe("computeSpendReport", () => {
  test("the headline is what the page used to work out in the browser", () => {
    const r = reportFor({});
    assert.deepEqual(r.now, totals(current));
    assert.deepEqual(r.before, totals(previous));
    assert.deepEqual(r.monthly, byMonth(current));
    assert.deepEqual(r.insights, insights(current, previous, "FY 2026–27", "FY 2025–26"));
  });

  test("only the section on screen is computed", () => {
    assert.deepEqual(reportFor({}).section, { key: "overview", statusMix: byStatus(current) });
    assert.equal(reportFor({ section: "unit-costs" }).section.key, "unit-costs");
  });

  test("Breakdown ranks and splits by the dimension asked for", () => {
    const r = reportFor({ section: "breakdown", breakdownBy: "vendor" });
    assert.deepEqual(r.section, {
      key: "breakdown",
      dimension: "vendor",
      ranked: byVendor(current),
      overTime: byMonthBreakdown(current, "vendor"),
    });
    const byCat = reportFor({ section: "breakdown" });
    assert.ok(byCat.section.key === "breakdown" && byCat.section.ranked.length === byCategory(current).length);
  });

  test("Compare uses the subjects picked in the filter bar, and gives item cards their average paid", () => {
    const r = reportFor({ section: "compare", compareBy: "item", item: "mutton" });
    assert.ok(r.section.key === "compare");
    assert.deepEqual(r.section.comparison, compare(current, "item", ["mutton"]));
    assert.equal(r.section.chosenCount, 1);
    assert.equal(r.section.unitCostByItem.mutton?.average, 15);
  });

  test("with nothing previous to compare, there is no before", () => {
    const r = computeSpendReport({
      current,
      previous: null,
      unitCosts,
      query: queryFromSearchParams({}, "au2026"),
      periodLabel: "FY 2026–27",
      previousLabel: "FY 2025–26",
    });
    assert.equal(r.before, null);
  });
});

describe("Transactions", () => {
  test("every line in the slice, newest first, adding up to the headline", () => {
    const r = reportFor({ section: "transactions" });
    assert.ok(r.section.key === "transactions");
    assert.equal(r.section.total, lines.length);
    assert.deepEqual(r.section.rows.map((x) => x.date), ["2026-08-20", "2026-08-10", "2026-08-10", "2026-07-03"]);
    assert.equal(Math.round(r.section.rows.reduce((s, x) => s + x.amount, 0) * 100) / 100, r.now.spend);
  });

  test("a filter narrows the list as it narrows the figures", () => {
    const meatOnly = applyFilters(expenses, lines, { ...NO_FILTERS, categoryIds: ["meat"] });
    const r = computeSpendReport({
      current: meatOnly,
      previous: null,
      unitCosts,
      query: queryFromSearchParams({ section: "transactions", category: "meat" }, "au2026"),
      periodLabel: "FY",
      previousLabel: "FY-1",
    });
    assert.ok(r.section.key === "transactions");
    assert.deepEqual(new Set(r.section.rows.map((x) => x.category)), new Set(["meat"]));
  });

  test("the page gets the newest thousand, and is told how many there are", () => {
    const many = Array.from({ length: TRANSACTIONS_ON_SCREEN + 5 }, (_, i) => line("e1", "meat", "mutton", 1 + i));
    const r = computeSpendReport({
      current: applyFilters(expenses, many, NO_FILTERS),
      previous: null,
      unitCosts,
      query: queryFromSearchParams({ section: "transactions" }, "au2026"),
      periodLabel: "FY",
      previousLabel: "FY-1",
    });
    const screen = forScreen(r);
    assert.ok(screen.section.key === "transactions" && r.section.key === "transactions");
    assert.equal(screen.section.rows.length, TRANSACTIONS_ON_SCREEN);
    assert.equal(screen.section.total, TRANSACTIONS_ON_SCREEN + 5);
    assert.equal(r.section.rows.length, TRANSACTIONS_ON_SCREEN + 5, "the download keeps them all");
  });
});

describe("discounts a category or item filter leaves out", () => {
  // e2: rice 150, mutton 50, and a $20 discount with no category.
  const withKind = [
    ...lines.map((l) => ({ ...l, kind: "goods" })),
    { ...line("e2", "", null, -20), categoryId: null, kind: "discount" },
    // A discount on a receipt the filter drops entirely is not this view's.
    { ...line("e3", "", null, -5), categoryId: null, kind: "discount" },
  ];
  const run = (params: Record<string, string>) => {
    const query = queryFromSearchParams(params, "au2026");
    const current = applyFilters(expenses, withKind, {
      month: null,
      vendorIds: query.vendors,
      categoryIds: query.categories,
      itemIds: query.items,
    });
    return computeSpendReport({
      current,
      previous: null,
      unitCosts,
      query,
      periodLabel: "FY",
      previousLabel: "",
      receiptLines: withKind,
    });
  };

  test("filtered to a category, the figures are before the discount on those receipts, and say so", () => {
    const r = run({ category: "meat" });
    // Mutton on e1 and e2; e2's discount is not in the figure…
    assert.equal(r.now.spend, 350);
    // …and is reported as left out. e3 isn't in the view, so its discount isn't either.
    assert.equal(r.discountsLeftOut, -20);
  });

  test("an item filter reports the same", () => {
    assert.equal(run({ item: "rice" }).discountsLeftOut, -20);
  });

  test("with no category or item filter, nothing is left out", () => {
    assert.equal(run({}).discountsLeftOut, 0);
    // A vendor filter keeps whole receipts, discounts and all.
    assert.equal(run({ vendor: "Costco" }).discountsLeftOut, 0);
  });

  test("a discount filed under the chosen category is in the figure, not left out", () => {
    const filed = withKind.map((l) => (l.kind === "discount" && l.expenseId === "e2" ? { ...l, categoryId: "meat" } : l));
    const query = queryFromSearchParams({ category: "meat" }, "au2026");
    const current = applyFilters(expenses, filed, { month: null, vendorIds: [], categoryIds: ["meat"], itemIds: [] });
    const r = computeSpendReport({ current, previous: null, unitCosts, query, periodLabel: "FY", previousLabel: "", receiptLines: filed });
    assert.equal(r.now.spend, 330);
    assert.equal(r.discountsLeftOut, 0);
  });
});

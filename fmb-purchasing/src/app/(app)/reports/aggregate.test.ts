import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyFilters,
  totals,
  byMonth,
  byMonthBreakdown,
  byCategory,
  byVendor,
  byItem,
  byStatus,
  percentChange,
  expenseDate,
  monthKey,
  formatMonthLabel,
  insights,
  NO_FILTERS,
  type ExpenseRecord,
  type LineRecord,
} from "./aggregate.ts";

/* ------------------------------------------------------------------ */
/* Fixtures — shaped like the real data: lines sum exactly to totals   */
/* ------------------------------------------------------------------ */

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
    receiptDate: "2026-05-20",
    createdAt: "2026-05-21T10:00:00Z",
    total: 300,
    gst: 27.27,
  },
  {
    id: "e3",
    expenseNumber: "E-0003",
    vendorId: "v-costco",
    vendorName: "Costco",
    status: "approved",
    // No receipt date: must fall back to createdAt, in June not May.
    receiptDate: null,
    createdAt: "2026-06-02T10:00:00Z",
    total: 200,
    gst: 18.18,
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
    categoryId: "c-meat",
    categoryName: "Meat & Poultry",
    itemId: "i-chicken",
    itemName: "Chicken",
    lineTotal: 180,
    quantity: 10,
  },
  {
    expenseId: "e2",
    categoryId: "c-bakery",
    categoryName: "Bakery",
    itemId: "i-rolls",
    itemName: "Dinner Rolls",
    lineTotal: 120,
    quantity: 12,
  },
  {
    expenseId: "e3",
    categoryId: "c-bakery",
    categoryName: "Bakery",
    itemId: "i-rolls",
    itemName: "Dinner Rolls",
    lineTotal: 200,
    quantity: 20,
  },
];

const all = applyFilters(expenses, lines, NO_FILTERS);

/* ------------------------------------------------------------------ */

describe("expenseDate", () => {
  test("prefers the receipt date", () => {
    assert.equal(expenseDate(expenses[0]), "2026-05-05");
  });

  test("falls back to the submission date when the receipt had none", () => {
    // Without this, a third of today's expenses would vanish from every
    // time-based chart.
    assert.equal(expenseDate(expenses[2]), "2026-06-02");
  });
});

describe("monthKey and formatMonthLabel", () => {
  test("buckets by calendar month", () => {
    assert.equal(monthKey("2026-05-05"), "2026-05");
  });

  test("labels a month without slipping to the previous one", () => {
    // A local-time Date built from a month boundary lands in the previous
    // month west of Greenwich; this must be UTC throughout.
    assert.equal(formatMonthLabel("2026-01"), "Jan 26");
    assert.equal(formatMonthLabel("2026-12"), "Dec 26");
  });
});

describe("totals", () => {
  test("spend is the sum of line totals", () => {
    assert.equal(totals(all).spend, 1820);
  });

  test("spend reconciles with the sum of expense totals when unfiltered", () => {
    // The guarantee the whole module rests on: lines are a faithful
    // decomposition, so both routes to the number agree.
    const viaExpenses = expenses.reduce((s, e) => s + e.total, 0);
    assert.equal(totals(all).spend, viaExpenses);
  });

  test("counts expenses and lines separately", () => {
    assert.equal(totals(all).expenseCount, 3);
    assert.equal(totals(all).lineCount, 4);
  });

  test("average is per expense, not per line", () => {
    assert.equal(totals(all).averageExpense, 1820 / 3);
  });

  test("average is zero rather than NaN on an empty slice", () => {
    const empty = applyFilters([], [], NO_FILTERS);
    assert.equal(totals(empty).averageExpense, 0);
    assert.equal(totals(empty).spend, 0);
  });

  test("cent-level sums don't drift into floating point noise", () => {
    const noisy: LineRecord[] = [0.1, 0.2, 0.3, 10.55, 20.45].map((v) => ({
      expenseId: "x",
      categoryId: "c",
      categoryName: "C",
      itemId: "i",
      itemName: "I",
      lineTotal: v,
      quantity: 1,
    }));
    const slice = { expenses: [], lines: noisy };
    // 0.1 + 0.2 alone is 0.30000000000000004 in binary floating point.
    assert.equal(totals(slice).spend, 31.6);
  });
});

describe("percentChange", () => {
  test("computes a signed fraction", () => {
    assert.equal(percentChange(150, 100), 0.5);
    assert.equal(percentChange(50, 100), -0.5);
  });

  test("returns null rather than Infinity when there's no baseline", () => {
    assert.equal(percentChange(100, 0), null);
  });
});

describe("applyFilters", () => {
  test("month filter uses the fallback date, so undated expenses land in the right bucket", () => {
    const may = applyFilters(expenses, lines, { ...NO_FILTERS, month: "2026-05" });
    assert.deepEqual(may.expenses.map((e) => e.id), ["e1", "e2"]);

    const june = applyFilters(expenses, lines, { ...NO_FILTERS, month: "2026-06" });
    assert.deepEqual(june.expenses.map((e) => e.id), ["e3"]);
  });

  test("vendor filter keeps only that vendor's expenses and their lines", () => {
    const costco = applyFilters(expenses, lines, { ...NO_FILTERS, vendorId: "v-costco" });
    assert.deepEqual(costco.expenses.map((e) => e.id), ["e2", "e3"]);
    assert.equal(totals(costco).spend, 500);
  });

  test("category filter reports only the matching lines, not the whole receipt", () => {
    // e2 is a $300 receipt with $180 of meat and $120 of bakery. Filtering
    // to meat must report $180 — reporting $300 would double-count that
    // receipt across two categories.
    const meat = applyFilters(expenses, lines, { ...NO_FILTERS, categoryIds: ["c-meat"] });
    assert.equal(totals(meat).spend, 1500);
    assert.deepEqual(meat.expenses.map((e) => e.id), ["e1", "e2"]);
  });

  test("category filter drops expenses left with no matching lines", () => {
    const bakery = applyFilters(expenses, lines, { ...NO_FILTERS, categoryIds: ["c-bakery"] });
    // e1 is meat only, so it must not appear in a bakery slice at all.
    assert.deepEqual(bakery.expenses.map((e) => e.id), ["e2", "e3"]);
    assert.equal(totals(bakery).expenseCount, 2);
    assert.equal(totals(bakery).spend, 320);
  });

  test("item filter narrows to one item across vendors", () => {
    const rolls = applyFilters(expenses, lines, { ...NO_FILTERS, itemIds: ["i-rolls"] });
    assert.equal(totals(rolls).spend, 320);
    assert.equal(totals(rolls).lineCount, 2);
  });

  test("filters compose", () => {
    const mayBakery = applyFilters(expenses, lines, {
      ...NO_FILTERS,
      month: "2026-05",
      categoryIds: ["c-bakery"],
    });
    assert.equal(totals(mayBakery).spend, 120);
    assert.deepEqual(mayBakery.expenses.map((e) => e.id), ["e2"]);
  });

  test("a filter matching nothing yields an empty slice, not everything", () => {
    const none = applyFilters(expenses, lines, { ...NO_FILTERS, vendorId: "v-nobody" });
    assert.equal(none.expenses.length, 0);
    assert.equal(none.lines.length, 0);
    assert.equal(totals(none).spend, 0);
  });
});

describe("multi-select filters", () => {
  test("several categories OR together", () => {
    const both = applyFilters(expenses, lines, {
      ...NO_FILTERS,
      categoryIds: ["c-meat", "c-bakery"],
    });
    // Everything, since between them the two cover every line.
    assert.equal(totals(both).spend, 1820);
    assert.equal(totals(both).lineCount, 4);
  });

  test("several items OR together", () => {
    const two = applyFilters(expenses, lines, {
      ...NO_FILTERS,
      itemIds: ["i-mutton", "i-rolls"],
    });
    assert.equal(totals(two).spend, 1640); // 1320 + 120 + 200
    assert.equal(totals(two).lineCount, 3);
  });

  test("different dimensions AND together", () => {
    // (meat OR bakery) AND (rolls) — the rolls lines only, not all of meat.
    const combined = applyFilters(expenses, lines, {
      ...NO_FILTERS,
      categoryIds: ["c-meat", "c-bakery"],
      itemIds: ["i-rolls"],
    });
    assert.equal(combined.lines.length, 2);
    assert.equal(totals(combined).spend, 320);
  });

  test("an impossible combination yields nothing rather than falling back to OR", () => {
    // Mutton is never in the bakery category; the AND must hold.
    const impossible = applyFilters(expenses, lines, {
      ...NO_FILTERS,
      categoryIds: ["c-bakery"],
      itemIds: ["i-mutton"],
    });
    assert.equal(impossible.lines.length, 0);
    assert.equal(impossible.expenses.length, 0);
  });

  test("an empty array means all, not none", () => {
    const empty = applyFilters(expenses, lines, { ...NO_FILTERS, categoryIds: [], itemIds: [] });
    assert.equal(totals(empty).spend, 1820);
  });
});

describe("byMonthBreakdown", () => {
  test("splits each month by the chosen dimension", () => {
    const b = byMonthBreakdown(all, "category");
    assert.deepEqual(b.months.map((m) => m.key), ["2026-05", "2026-06"]);

    const meat = b.series.find((s) => s.label === "Meat & Poultry")!;
    const bakery = b.series.find((s) => s.label === "Bakery")!;
    // Meat is all in May; bakery straddles both months.
    assert.deepEqual(meat.values, [1500, 0]);
    assert.deepEqual(bakery.values, [120, 200]);
  });

  test("each series total matches the sum of its months", () => {
    for (const s of byMonthBreakdown(all, "item").series) {
      assert.equal(s.total, Math.round(s.values.reduce((a, b) => a + b, 0) * 100) / 100);
    }
  });

  test("every month column sums to that month's overall spend", () => {
    const b = byMonthBreakdown(all, "vendor");
    const monthly = byMonth(all);
    b.months.forEach((m, i) => {
      const column = b.series.reduce((s, ser) => s + ser.values[i], 0);
      assert.equal(Math.round(column * 100) / 100, monthly[i].spend);
    });
  });

  test("ranks series by total, largest first", () => {
    const b = byMonthBreakdown(all, "category");
    assert.equal(b.series[0].label, "Meat & Poultry");
  });

  test("folds the tail into Other rather than inventing a ninth colour", () => {
    // Ten distinct items, capped at 3 series: two named plus "Other (8)".
    const many: LineRecord[] = Array.from({ length: 10 }, (_, i) => ({
      expenseId: "e1",
      categoryId: "c",
      categoryName: "C",
      itemId: `item-${i}`,
      itemName: `Item ${i}`,
      lineTotal: 100 - i, // descending, so ranking is predictable
      quantity: 1,
    }));
    const slice = { expenses: [expenses[0]], lines: many };
    const b = byMonthBreakdown(slice, "item", 3);

    assert.equal(b.series.length, 3);
    assert.equal(b.series[2].label, "Other (8)");
    assert.equal(b.foldedCount, 8);
    // Folding must not lose money.
    const total = b.series.reduce((s, ser) => s + ser.total, 0);
    assert.equal(Math.round(total * 100) / 100, 955);
  });

  test("returns empty structures rather than throwing on an empty slice", () => {
    const b = byMonthBreakdown({ expenses: [], lines: [] }, "category");
    assert.deepEqual(b.months, []);
    assert.deepEqual(b.series, []);
  });
});

describe("byMonth", () => {
  test("is chronological, not ranked by size", () => {
    const months = byMonth(all);
    assert.deepEqual(months.map((m) => m.key), ["2026-05", "2026-06"]);
  });

  test("splits spend into the right months", () => {
    const months = byMonth(all);
    assert.equal(months[0].spend, 1620); // e1 1320 + e2 300
    assert.equal(months[1].spend, 200); // e3, by its fallback date
  });

  test("counts expenses per month without double-counting multi-line ones", () => {
    const months = byMonth(all);
    assert.equal(months[0].count, 2);
    assert.equal(months[1].count, 1);
  });
});

describe("byCategory", () => {
  test("ranks by spend descending", () => {
    const cats = byCategory(all);
    assert.deepEqual(cats.map((c) => c.label), ["Meat & Poultry", "Bakery"]);
    assert.equal(cats[0].spend, 1500);
    assert.equal(cats[1].spend, 320);
  });

  test("category totals sum to overall spend", () => {
    assert.equal(
      byCategory(all).reduce((s, c) => s + c.spend, 0),
      totals(all).spend
    );
  });
});

describe("byVendor", () => {
  test("attributes each expense's line spend to its vendor", () => {
    const vendors = byVendor(all);
    assert.deepEqual(vendors.map((v) => v.label), ["Madani Mart", "Costco"]);
    assert.equal(vendors[0].spend, 1320);
    assert.equal(vendors[1].spend, 500);
  });

  test("counts expenses per vendor, not lines", () => {
    const costco = byVendor(all).find((v) => v.label === "Costco")!;
    assert.equal(costco.count, 2);
  });

  test("vendor totals sum to overall spend", () => {
    assert.equal(
      byVendor(all).reduce((s, v) => s + v.spend, 0),
      totals(all).spend
    );
  });
});

describe("byItem", () => {
  test("combines the same item across vendors and receipts", () => {
    const rolls = byItem(all).find((i) => i.label === "Dinner Rolls")!;
    assert.equal(rolls.spend, 320);
    assert.equal(rolls.count, 2);
  });

  test("ranks by spend", () => {
    assert.equal(byItem(all)[0].label, "Mutton");
  });
});

describe("byStatus", () => {
  test("reads in pipeline order, not by size", () => {
    // Otherwise the bar reshuffles as amounts change, which reads as noise.
    assert.deepEqual(byStatus(all).map((s) => s.key), ["submitted", "approved", "paid"]);
  });

  test("omits statuses with nothing in them", () => {
    assert.equal(byStatus(all).find((s) => s.key === "declined"), undefined);
  });

  test("status totals sum to overall spend", () => {
    assert.equal(
      byStatus(all).reduce((s, b) => s + b.spend, 0),
      totals(all).spend
    );
  });
});

describe("insights", () => {
  test("says nothing at all when there's no data", () => {
    const empty = applyFilters([], [], NO_FILTERS);
    assert.deepEqual(insights(empty, null, "this year", "last year"), []);
  });

  test("reports direction of change against the previous period", () => {
    const may = applyFilters(expenses, lines, { ...NO_FILTERS, month: "2026-05" });
    const june = applyFilters(expenses, lines, { ...NO_FILTERS, month: "2026-06" });
    const found = insights(june, may, "June", "May");
    const change = found.find((i) => i.text.includes("lower"));
    assert.ok(change, "expected a statement that spend fell");
    assert.equal(change.tone, "down");
  });

  test("names the largest category with its share", () => {
    const found = insights(all, null, "this year", "last year");
    assert.ok(found.some((i) => i.text.includes("Meat & Poultry") && i.text.includes("82%")));
  });

  test("flags what is still awaiting review", () => {
    const found = insights(all, null, "this year", "last year");
    assert.ok(found.some((i) => i.text.includes("awaiting review")));
  });
});

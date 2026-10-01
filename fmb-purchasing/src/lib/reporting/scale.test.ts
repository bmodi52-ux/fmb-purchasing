import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyFilters, NO_FILTERS, type ExpenseRecord, type LineRecord } from "./aggregate.ts";
import { queryFromSearchParams } from "./query.ts";
import { computeSpendReport } from "./spend-report.ts";
import { transactionsPage } from "./spend-tables.ts";

/**
 * Reports add up on the server, from a ledger held a month at a time. This
 * holds them to staying quick as the ledger grows: ten years of a kitchen far
 * busier than this one. Live today is 121 expenses and 434 lines; this is
 * 20,000 and 200,000.
 *
 * The limit is generous — a slow CI machine must not fail it — and is there
 * to catch work done once per line that should be done once, or anything
 * that grows with the square of the data; not to time anything finely. The
 * run prints what each took.
 */

/**
 * Each of these takes a few hundred milliseconds on a laptop. Before month
 * labels were worked out once each (aggregate formatMonthLabel), they took
 * 2.6 to 5.3 seconds — which is what this limit is set to catch.
 */
const LIMIT_MS = 2500;

const EXPENSES = 20_000;
const LINES_EACH = 10;
const VENDORS = 60;
const CATEGORIES = 30;
const ITEMS = 400;

function synthetic(): { expenses: ExpenseRecord[]; lines: LineRecord[] } {
  const expenses: ExpenseRecord[] = [];
  const lines: LineRecord[] = [];
  const start = Date.UTC(2017, 0, 1);
  for (let i = 0; i < EXPENSES; i++) {
    const day = new Date(start + (i % 3650) * 86_400_000).toISOString().slice(0, 10);
    const id = `e${i}`;
    let total = 0;
    for (let j = 0; j < LINES_EACH; j++) {
      const lineTotal = ((i * 31 + j * 17) % 9000) / 100 + 1;
      total += lineTotal;
      const item = (i * 7 + j) % ITEMS;
      lines.push({
        expenseId: id,
        categoryId: `c${item % CATEGORIES}`,
        categoryName: `Category ${item % CATEGORIES}`,
        itemId: `i${item}`,
        itemName: `Item ${item}`,
        lineTotal,
        gst: j % 4 === 0 ? lineTotal / 11 : 0,
        gstApportioned: false,
        quantity: 1 + (j % 5),
      });
    }
    expenses.push({
      id,
      expenseNumber: `E-${String(i).padStart(5, "0")}`,
      vendorId: `v${i % VENDORS}`,
      vendorName: `Vendor ${i % VENDORS}`,
      status: i % 10 === 0 ? "submitted" : i % 10 === 1 ? "approved" : "paid",
      receiptDate: day,
      createdAt: `${day}T02:00:00Z`,
      reportDate: day,
      total,
      gst: 0,
    } as ExpenseRecord);
  }
  return { expenses, lines };
}

describe("reports at ten years' scale", () => {
  const { expenses, lines } = synthetic();

  for (const section of ["overview", "breakdown", "compare", "transactions"] as const) {
    test(`${section}: ${EXPENSES.toLocaleString()} expenses, ${(EXPENSES * LINES_EACH).toLocaleString()} lines`, (t) => {
      const started = performance.now();
      const query = queryFromSearchParams({ section }, "cy2026");
      const report = computeSpendReport({
        current: applyFilters(expenses, lines, NO_FILTERS),
        previous: null,
        unitCosts: [],
        query,
        periodLabel: "All",
        previousLabel: "",
      });
      const took = performance.now() - started;
      t.diagnostic(`${section}: ${Math.round(took)} ms`);
      assert.equal(report.now.expenseCount, EXPENSES);
      assert.ok(took < LIMIT_MS, `${section} took ${Math.round(took)} ms`);
    });
  }

  test("a category filter, then one sorted page of the lines", (t) => {
    const started = performance.now();
    const query = queryFromSearchParams({ section: "transactions", category: "c3" }, "cy2026");
    const report = computeSpendReport({
      current: applyFilters(expenses, lines, { month: null, vendorIds: [], categoryIds: ["c3"], itemIds: [] }),
      previous: null,
      unitCosts: [],
      query,
      periodLabel: "All",
      previousLabel: "",
    });
    const page = transactionsPage(report, { sort: { key: "amount", dir: "desc" }, page: 2 })!;
    const took = performance.now() - started;
    t.diagnostic(`filter + sort + page: ${Math.round(took)} ms for ${page.view.total.toLocaleString()} lines`);
    // Only one page of them would cross the network, however many there are.
    assert.equal(page.table.rows.length, 50);
    assert.ok(page.view.total > 5000);
    assert.ok(took < LIMIT_MS, `took ${Math.round(took)} ms`);
  });
});

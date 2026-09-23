import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { changeSinceLast, recentDates, totalValue, valueOf, type StockCount } from "./stock-count.ts";

const counts: StockCount[] = [
  { countedOn: "2026-08-31", itemId: "rice", quantity: 12, unitCode: "bag", toBase: 10 },
  { countedOn: "2026-09-30", itemId: "rice", quantity: 90, unitCode: "kg", toBase: 1 },
  { countedOn: "2026-09-30", itemId: "ghee", quantity: 8, unitCode: "L", toBase: 1 },
];

describe("stock count", () => {
  test("values a count in the item's base unit", () => {
    assert.equal(valueOf(counts[0], 2.5), 300, "12 bags of 10 kg at $2.50/kg");
    assert.equal(valueOf(counts[0], null), null);
  });

  test("compares counts made in different units", () => {
    assert.equal(changeSinceLast(counts, "rice"), -30, "120 kg down to 90 kg");
    assert.equal(changeSinceLast(counts, "ghee"), null, "counted once so far");
  });

  test("columns are the latest dates first", () => {
    assert.deepEqual(recentDates(counts), ["2026-09-30", "2026-08-31"]);
  });

  test("totals a date, and says how much had no price", () => {
    const price = (id: string) => (id === "rice" ? 2.5 : null);
    assert.deepEqual(totalValue(counts, "2026-09-30", price), { value: 225, unpriced: 1 });
  });
});

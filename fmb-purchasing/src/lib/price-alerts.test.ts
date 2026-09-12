import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cheapestRecent,
  describePriceFlag,
  describeUnusualSpend,
  limitsFor,
  median,
  previousPurchase,
  priceFlagsFor,
  spendHistoryFor,
  unusualSpend,
  type PricePoint,
} from "./price-alerts.ts";

const pricelist = { risePercent: 10, fallPercent: 10 };
const noLimits = { price_rise_percent: null, price_fall_percent: null };
const noRange = { ...noLimits, expected_min_per_unit: null, expected_max_per_unit: null };

function point(over: Partial<PricePoint>): PricePoint {
  return {
    lineId: "l1",
    expenseId: "e1",
    itemId: "chicken",
    vendorId: "v1",
    date: "2026-09-01",
    submittedAt: "2026-09-01T10:00:00Z",
    costPerUnit: 8,
    unit: "kg",
    confirmed: true,
    ...over,
  };
}

describe("limitsFor", () => {
  test("the Pricelist's limits when nothing more specific is set", () => {
    const limits = limitsFor(pricelist, noLimits, noRange);
    assert.equal(limits.rise, 10);
    assert.equal(limits.fall, 10);
    assert.equal(limits.riseFrom, "pricelist");
  });

  test("a category's limit over the Pricelist's, and an item's over both — rises and falls separately", () => {
    const limits = limitsFor(
      pricelist,
      { price_rise_percent: "5", price_fall_percent: "25" },
      { ...noRange, price_rise_percent: 3 }
    );
    assert.deepEqual([limits.rise, limits.riseFrom], [3, "item"]);
    assert.deepEqual([limits.fall, limits.fallFrom], [25, "category"]);
  });
});

describe("previousPurchase", () => {
  const now = point({ lineId: "now", expenseId: "e-now", date: "2026-09-10" });

  test("the latest earlier purchase from any vendor, on another expense", () => {
    const history = [
      point({ lineId: "a", expenseId: "ea", date: "2026-08-01", costPerUnit: 7 }),
      point({ lineId: "b", expenseId: "eb", date: "2026-09-05", vendorId: "v2", costPerUnit: 7.2 }),
      point({ lineId: "later", expenseId: "ec", date: "2026-09-12", costPerUnit: 9 }),
      point({ lineId: "same-expense", expenseId: "e-now", date: "2026-09-09", costPerUnit: 1 }),
      now,
    ];
    assert.equal(previousPurchase(now, history)?.lineId, "b");
  });

  test("never one whose pack contents are unconfirmed, or in another unit", () => {
    const history = [
      point({ lineId: "ok", expenseId: "ea", date: "2026-08-01" }),
      point({ lineId: "unconfirmed", expenseId: "eb", date: "2026-09-01", confirmed: false }),
      point({ lineId: "each", expenseId: "ec", date: "2026-09-02", unit: "ea" }),
    ];
    assert.equal(previousPurchase(now, history)?.lineId, "ok");
  });

  test("on the same day, the one submitted earlier", () => {
    const history = [
      point({ lineId: "earlier", expenseId: "ea", date: "2026-09-10", submittedAt: "2026-09-10T08:00:00Z" }),
      point({ lineId: "after", expenseId: "eb", date: "2026-09-10", submittedAt: "2026-09-10T23:00:00Z" }),
    ];
    const at = point({ ...now, submittedAt: "2026-09-10T12:00:00Z" });
    assert.equal(previousPurchase(at, history)?.lineId, "earlier");
  });
});

describe("priceFlagsFor", () => {
  const limits = limitsFor(pricelist, noLimits, noRange);

  test("a rise past the limit, but not one at it", () => {
    const before = point({ lineId: "p", expenseId: "ep", costPerUnit: 7.2 });
    const flags = priceFlagsFor(point({ costPerUnit: 8.5 }), before, limits, "Chicken Thigh");
    assert.equal(flags.length, 1);
    assert.equal(flags[0].kind, "rise");
    assert.equal(describePriceFlag(flags[0]), "Chicken Thigh up 18% on the last purchase: $7.20/kg → $8.50/kg");

    const atLimit = priceFlagsFor(point({ costPerUnit: 11 }), point({ costPerUnit: 10 }), limits, "x");
    assert.deepEqual(atLimit, []);
  });

  test("a fall judged against the fall limit", () => {
    const loose = limitsFor(pricelist, { price_rise_percent: null, price_fall_percent: 30 }, noRange);
    assert.deepEqual(priceFlagsFor(point({ costPerUnit: 8 }), point({ costPerUnit: 10 }), loose, "x"), []);
    const flags = priceFlagsFor(point({ costPerUnit: 6 }), point({ costPerUnit: 10 }), loose, "Rice");
    assert.equal(flags[0].kind, "fall");
    assert.match(describePriceFlag(flags[0]), /^Rice down 40%/);
  });

  test("outside the expected range, whatever the last purchase was", () => {
    const ranged = limitsFor(pricelist, noLimits, { ...noLimits, expected_min_per_unit: 6.5, expected_max_per_unit: "8" });
    const flags = priceFlagsFor(point({ costPerUnit: 8.4 }), point({ costPerUnit: 8.3 }), ranged, "Chicken");
    assert.deepEqual(
      flags.map((f) => f.kind),
      ["above_range"]
    );
    assert.equal(describePriceFlag(flags[0]), "Chicken at $8.40/kg, above the expected $6.50/kg–$8.00/kg");
    assert.deepEqual(priceFlagsFor(point({ costPerUnit: 8 }), null, ranged, "Chicken"), []);
    assert.equal(priceFlagsFor(point({ costPerUnit: 6 }), null, ranged, "Chicken")[0].kind, "below_range");
  });

  test("nothing for a purchase whose pack contents are unconfirmed", () => {
    assert.deepEqual(priceFlagsFor(point({ costPerUnit: 50, confirmed: false }), point({ costPerUnit: 8 }), limits, "x"), []);
  });
});

describe("unusual spend", () => {
  const settings = { spendMultiple: 3, spendMinHistory: 5 };

  test("the median, so one big order does not make the next look normal", () => {
    assert.equal(median([100, 120, 5000, 110, 90]), 110);
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  test("flagged at the multiple, with enough history to judge by", () => {
    const history = [100, 120, 5000, 110, 90];
    const found = unusualSpend(400, history, settings);
    assert.deepEqual(found, { multiple: 3.6, typical: 110, historyCount: 5 });
    assert.equal(describeUnusualSpend(found!), "3.6× this vendor's usual expense (about $110.00)");
    assert.equal(unusualSpend(300, history, settings), null);
    assert.equal(unusualSpend(4000, history.slice(0, 4), settings), null);
  });

  test("history is the same vendor's other expenses in the year up to this one", () => {
    const e = { id: "e", vendor_id: "v", total: 500, receipt_date: "2026-09-10", created_at: "2026-09-10T00:00:00Z" };
    const others = [
      { id: "a", vendor_id: "v", total: 100, receipt_date: "2026-01-01", created_at: "2026-01-01T00:00:00Z" },
      { id: "old", vendor_id: "v", total: 100, receipt_date: "2025-09-01", created_at: "2025-09-01T00:00:00Z" },
      { id: "later", vendor_id: "v", total: 100, receipt_date: "2026-09-11", created_at: "2026-09-11T00:00:00Z" },
      { id: "other", vendor_id: "w", total: 100, receipt_date: "2026-05-01", created_at: "2026-05-01T00:00:00Z" },
      { id: "undated", vendor_id: "v", total: "90", receipt_date: null, created_at: "2026-06-01T03:00:00Z" },
      e,
    ];
    assert.deepEqual(spendHistoryFor(e, others), [100, 90]);
  });
});

describe("cheapestRecent", () => {
  test("the lowest confirmed price per unit since the date, and who charged it", () => {
    const found = cheapestRecent(
      [
        point({ itemId: "rice", vendorId: "a", costPerUnit: 3, date: "2026-08-01" }),
        point({ itemId: "rice", vendorId: "b", costPerUnit: 2.5, date: "2026-08-15" }),
        point({ itemId: "rice", vendorId: "c", costPerUnit: 1, date: "2026-01-01" }),
        point({ itemId: "rice", vendorId: "d", costPerUnit: 0.5, date: "2026-08-20", confirmed: false }),
      ],
      "2026-06-01"
    );
    assert.deepEqual(found.get("rice"), { costPerUnit: 2.5, unit: "kg", vendorId: "b", date: "2026-08-15" });
  });
});

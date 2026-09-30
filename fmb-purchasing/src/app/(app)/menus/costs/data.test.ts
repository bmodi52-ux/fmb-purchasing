import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { thaaliCostsPeriod, thaaliCostTables, type ThaaliCostsView } from "./data.ts";

const TODAY = "2026-09-30";

describe("thaaliCostsPeriod", () => {
  test("opens on the last three months, as it always did", () => {
    const p = thaaliCostsPeriod({}, TODAY);
    assert.equal(p.start, "2026-07-01");
    assert.equal(p.end, TODAY);
  });

  test("a link from before the period picker keeps its dates", () => {
    const p = thaaliCostsPeriod({ from: "2026-08-01", to: "2026-08-31" }, TODAY);
    assert.equal(p.code, "r2026-08-01_2026-08-31");
  });

  test("an end before the start is ignored, as it was", () => {
    const p = thaaliCostsPeriod({ from: "2026-08-10", to: "2026-08-01" }, TODAY);
    assert.deepEqual([p.start, p.end], ["2026-08-10", TODAY]);
  });

  test("a period from the picker wins", () => {
    const p = thaaliCostsPeriod({ period: "cy2026-m8", from: "2026-01-01" }, TODAY);
    assert.deepEqual([p.start, p.end], ["2026-08-01", "2026-08-31"]);
  });
});

describe("thaaliCostTables", () => {
  test("by day carries the page's totals; a day with nothing bought has no spend a thaali", () => {
    const view = {
      period: thaaliCostsPeriod({}, TODAY),
      kitchens: [],
      kitchenId: null,
      costDays: [],
      rows: [
        { date: "2026-09-01", kitchenName: "Main", thaalis: 100, planned: 250, actual: 0, plannedPerThaali: 2.5, actualPerThaali: null, stillToBuy: 3 },
      ],
      totals: { days: 1, thaalis: 100, planned: 250, actual: 0, plannedPerThaali: 2.5, actualPerThaali: null, fullyBoughtDays: 0 },
      sections: [],
      dishes: [{ name: "Daal", days: 1, boxes: 0, cost: 12.345, unpriced: true }],
    } satisfies ThaaliCostsView;
    const [byDay, , byDish] = thaaliCostTables(view);
    assert.equal(byDay.rows[0].actualPerThaali, null);
    assert.equal(byDay.totals!.planned, 250);
    assert.deepEqual(byDish.rows[0], { name: "Daal", days: 1, boxes: 0, cost: 12.35, perBox: null, unpriced: "Yes" });
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { dayCostRows, sectionTotals, totalsOf, type CostDay } from "./thaali-costs.ts";

const days: CostDay[] = [
  {
    date: "2026-09-18",
    kitchenId: "k1",
    kitchenName: "Main kitchen",
    thaalis: 200,
    requirements: [
      { section: "meat", plannedCost: 1200, spent: 1250, complete: true },
      { section: "produce", plannedCost: 300, spent: 280, complete: true },
    ],
  },
  {
    date: "2026-09-25",
    kitchenId: "k1",
    kitchenName: "Main kitchen",
    thaalis: 100,
    requirements: [
      { section: "meat", plannedCost: 600, spent: 0, complete: false },
      { section: "dry", plannedCost: null, spent: 0, complete: false },
    ],
  },
];

describe("cost per thaali", () => {
  test("each day, planned and actual", () => {
    const [a, b] = dayCostRows(days);
    assert.deepEqual(
      { planned: a.planned, actual: a.actual, per: a.plannedPerThaali, actualPer: a.actualPerThaali, left: a.stillToBuy },
      { planned: 1500, actual: 1530, per: 7.5, actualPer: 7.65, left: 0 }
    );
    assert.equal(b.stillToBuy, 2);
    assert.equal(b.actualPerThaali, 0);
  });

  test("the stretch's actual is only over days bought for in full", () => {
    const t = totalsOf(dayCostRows(days));
    assert.equal(t.planned, 2100);
    assert.equal(t.plannedPerThaali, 7);
    assert.equal(t.actualPerThaali, 7.65, "the half-bought day is left out, not counted as cheap");
    assert.equal(t.fullyBoughtDays, 1);
  });

  test("a day with no count has no per-thaali figure rather than a division by nought", () => {
    const [row] = dayCostRows([{ ...days[0], thaalis: 0 }]);
    assert.equal(row.plannedPerThaali, null);
  });
});

describe("by section", () => {
  test("adds each section across the days", () => {
    const meat = sectionTotals(days).find((s) => s.section === "meat")!;
    assert.deepEqual(meat, { section: "meat", planned: 1800, actual: 1250, plannedPerThaali: 6 });
  });
});

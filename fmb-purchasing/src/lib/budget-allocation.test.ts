import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { allocate, budgetForPeriod, planBudgetSave, type BudgetRecord } from "./budget-allocation.ts";

/**
 * The worked example agreed on 2026-09-11 (scratchpad #22), with its made-up
 * dates: a Hijri budget of $9,000 for 1 May 2026 – 19 Apr 2027 (354 days), and
 * a financial year 1 Jul 2026 – 30 Jun 2027 set at $10,000.
 */

const hijri: BudgetRecord = {
  id: "hijri",
  start: "2026-05-01",
  end: "2027-04-19",
  amount: 9000,
  priority: 1,
  label: "1447-48 H",
};

const fy = { start: "2026-07-01", end: "2027-06-30", label: "FY 2026–27" };

describe("allocate", () => {
  test("the older budget keeps its days; the newer one's remainder goes on the uncovered days", () => {
    const budgets = [hijri, { ...fy, id: "fy", amount: 10000, priority: 0 }];
    const a = allocate(budgets);
    const inside = budgetForPeriod(a, budgets, fy.start, fy.end);
    assert.equal(inside.amount, 10000);
    assert.equal(inside.uncoveredDays, 0);
    const hijriPart = inside.sources.find((s) => s.budgetId === "hijri")!.amount;
    assert.equal(Math.round(hijriPart), 7449);
    assert.equal(Math.round(inside.sources.find((s) => s.budgetId === "fy")!.amount), 2551);
    // And the Hijri year still adds up to its own total.
    assert.equal(budgetForPeriod(a, budgets, hijri.start, hijri.end).amount, 9000);
  });

  test("days with no budget are counted, not silently shown as a smaller budget", () => {
    const a = allocate([hijri]);
    const inside = budgetForPeriod(a, [hijri], fy.start, fy.end);
    assert.equal(inside.uncoveredDays, 72);
  });
});

describe("planBudgetSave", () => {
  test("a new budget that fits saves without changing anything else", () => {
    const plan = planBudgetSave([hijri], { ...fy, amount: 10000 });
    assert.equal(plan.conflicts, false);
    assert.deepEqual(plan.override.changes, []);
  });

  test("a new budget smaller than what is already on its days conflicts, and the override moves the other total", () => {
    const plan = planBudgetSave([hijri], { ...fy, amount: 7000 });
    assert.equal(plan.conflicts, true);
    const [change] = plan.override.changes;
    assert.equal(change.budgetId, "hijri");
    assert.equal(change.from, 9000);
    // The Hijri year keeps its 61 days before July at $25.42 a day, and its
    // 293 days inside the financial year now carry the financial year's rate.
    const expected = 61 * (9000 / 354) + 293 * (7000 / 365);
    assert.equal(Math.round(change.to), Math.round(expected));

    const a = allocate(plan.override.budgets);
    assert.equal(budgetForPeriod(a, plan.override.budgets, fy.start, fy.end).amount, 7000);
  });

  test("a new budget whose days are all covered conflicts", () => {
    const quarter = { start: "2026-07-01", end: "2026-09-30", label: "Q1 FY 2026–27", amount: 3000 };
    const plan = planBudgetSave([hijri], quarter);
    assert.equal(plan.conflicts, true);
    const a = allocate(plan.override.budgets);
    assert.equal(budgetForPeriod(a, plan.override.budgets, quarter.start, quarter.end).amount, 3000);
  });

  test("raising the older budget recalculates the newer one's remainder while it can", () => {
    const existing = [hijri, { ...fy, id: "fy", amount: 10000, priority: 0 }];
    const plan = planBudgetSave(existing, { ...hijri, amount: 9500 });
    assert.equal(plan.conflicts, false);
    const a = allocate(plan.plain.budgets);
    assert.equal(budgetForPeriod(a, plan.plain.budgets, fy.start, fy.end).amount, 10000);
  });

  test("raising it past what the newer one can absorb conflicts, and the override moves the newer total", () => {
    const existing = [hijri, { ...fy, id: "fy", amount: 10000, priority: 0 }];
    const plan = planBudgetSave(existing, { ...hijri, amount: 13000 });
    assert.equal(plan.conflicts, true);
    const change = plan.override.changes.find((c) => c.budgetId === "fy")!;
    assert.equal(change.from, 10000);
    // 293 days now carry the Hijri year's new rate; the 72 uncovered days keep theirs.
    const expected = 293 * (13000 / 354) + 72 * ((10000 - 293 * (9000 / 354)) / 72);
    assert.equal(Math.round(change.to), Math.round(expected));
    assert.equal(plan.override.budgets.find((b) => b.id === "hijri")!.amount, 13000);
  });
});

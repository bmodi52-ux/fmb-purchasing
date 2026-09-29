import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { budgetActuals, budgetTotals, type SpendLine } from "./budget-actuals.ts";

const categories = [
  { id: "meat", parent_category_id: null },
  { id: "meat-mutton", parent_category_id: "meat" },
  { id: "meat-chicken", parent_category_id: "meat" },
  { id: "veg", parent_category_id: null },
  { id: "dairy", parent_category_id: null },
];

const status = new Map([
  ["e-paid", "paid"],
  ["e-approved", "approved"],
  ["e-waiting", "submitted"],
]);

const lines: SpendLine[] = [
  { expenseId: "e-paid", categoryId: "meat-mutton", lineTotal: 1000 },
  { expenseId: "e-approved", categoryId: "meat-mutton", lineTotal: 200 },
  { expenseId: "e-waiting", categoryId: "veg", lineTotal: 300 },
  // Filed against "Meat" itself rather than a cut of it — as one live line is.
  { expenseId: "e-approved", categoryId: "meat", lineTotal: 5760 },
  // A card surcharge, and a line on a category since deleted.
  { expenseId: "e-paid", categoryId: null, lineTotal: 12.5 },
  { expenseId: "e-paid", categoryId: "gone", lineTotal: 7.5 },
];

describe("budgetActuals", () => {
  const actuals = budgetActuals(lines, status, categories);

  test("spend lands on its leaf, split into paid and the rest", () => {
    assert.deepEqual(actuals.byLeaf.get("meat-mutton"), { spent: 1200, paid: 1000 });
    assert.deepEqual(actuals.byLeaf.get("veg"), { spent: 300, paid: 0 });
  });

  test("a line on a parent category is named as that, not called uncategorised", () => {
    assert.deepEqual(actuals.onParentCategories, [{ categoryId: "meat", amount: 5760 }]);
    assert.equal(actuals.byLeaf.has("meat"), false);
  });

  test("uncategorised is only what has no category, or one that no longer exists", () => {
    assert.equal(actuals.uncategorised, 20);
  });

  test("every dollar is accounted for", () => {
    const leaves = [...actuals.byLeaf.values()].reduce((s, l) => s + l.spent, 0);
    const parents = actuals.onParentCategories.reduce((s, p) => s + p.amount, 0);
    const total = lines.reduce((s, l) => s + l.lineTotal, 0);
    assert.equal(leaves + parents + actuals.uncategorised, total);
  });
});

describe("budgetTotals", () => {
  test("remaining takes off only what the budgeted categories spent", () => {
    // Mutton has a $2,000 budget and spent $1,200; vegetables have none and
    // spent $300. $800 remains — not $500.
    const t = budgetTotals([
      { budget: 2000, spent: 1200, paid: 1000 },
      { budget: null, spent: 300, paid: 0 },
    ]);
    assert.equal(t.budgeted, 2000);
    assert.equal(t.spentAgainstBudgets, 1200);
    assert.equal(t.remaining, 800);
  });

  test("paid and committed still cover every category", () => {
    const t = budgetTotals([
      { budget: 2000, spent: 1200, paid: 1000 },
      { budget: null, spent: 300, paid: 0 },
    ]);
    assert.equal(t.paid, 1000);
    assert.equal(t.committed, 500);
  });

  test("goes negative when budgeted categories overspend", () => {
    assert.equal(budgetTotals([{ budget: 100, spent: 150.25, paid: 0 }]).remaining, -50.25);
  });

  test("with nothing budgeted there is no remaining to speak of", () => {
    assert.equal(budgetTotals([{ budget: null, spent: 300, paid: 0 }]).remaining, null);
  });

  test("a budget of zero is still a budget", () => {
    assert.equal(budgetTotals([{ budget: 0, spent: 40, paid: 0 }]).remaining, -40);
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { describeSelection, formatMoney, sumAmounts } from "./selection-summary";

describe("sumAmounts", () => {
  test("adds money exactly, where floats would drift", () => {
    assert.equal(sumAmounts([0.1, 0.2]), 0.3);
    assert.equal(sumAmounts([1234.56, 4567.89, 524.7]), 6327.15);
  });

  test("a hundred small amounts still land on the cent", () => {
    assert.equal(sumAmounts(Array.from({ length: 100 }, () => 0.07)), 7);
  });

  test("nothing selected is nothing, not NaN", () => {
    assert.equal(sumAmounts([]), 0);
  });

  test("a row with no amount is skipped rather than poisoning the total", () => {
    assert.equal(sumAmounts([10, null, undefined, Number.NaN, 5]), 15);
  });

  test("credits and refunds subtract", () => {
    assert.equal(sumAmounts([100, -25.5]), 74.5);
  });
});

describe("describeSelection", () => {
  test("the count and what it comes to", () => {
    assert.equal(describeSelection(3, 6327.15), "3 selected · $6,327.15");
  });

  test("rows with no money to add say only how many", () => {
    assert.equal(describeSelection(3, null), "3 selected");
  });

  test("a selection that nets to nothing still says so", () => {
    assert.equal(describeSelection(2, 0), "2 selected · $0.00");
  });
});

describe("formatMoney", () => {
  test("Australian dollars, grouped", () => {
    assert.equal(formatMoney(6327.15), "$6,327.15");
    assert.equal(formatMoney(-25.5), "-$25.50");
  });
});

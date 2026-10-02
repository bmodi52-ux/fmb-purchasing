import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { labelEvery, niceScale, sharePercent, shortMoney, splitName, wholeMoney } from "./chart-scale.ts";

describe("niceScale", () => {
  test("the lines are round figures and the top holds the largest value", () => {
    assert.deepEqual(niceScale(44_825.24), { top: 45_000, ticks: [0, 15_000, 30_000, 45_000] });
    assert.deepEqual(niceScale(30_296.23), { top: 45_000, ticks: [0, 15_000, 30_000, 45_000] });
    assert.deepEqual(niceScale(30_000), { top: 30_000, ticks: [0, 10_000, 20_000, 30_000] });
    assert.deepEqual(niceScale(952), { top: 1_200, ticks: [0, 400, 800, 1_200] });
    assert.deepEqual(niceScale(7), { top: 7.5, ticks: [0, 2.5, 5, 7.5] });
  });

  test("the top is never below the value, across magnitudes", () => {
    for (const max of [0.07, 0.9, 1, 3, 9.99, 10, 99, 101, 2_400, 2_401, 89_999, 90_001, 1_234_567]) {
      const { top, ticks } = niceScale(max);
      assert.ok(top >= max, `${max} → ${top}`);
      // And never so far above that the chart is mostly air.
      assert.ok(top <= max * 2, `${max} → ${top}`);
      assert.equal(ticks.length, 4);
      assert.equal(ticks[3], top);
    }
  });

  test("small scales are not smeared by floating point", () => {
    assert.deepEqual(niceScale(0.85).ticks, [0, 0.3, 0.6, 0.9]);
  });

  test("nothing to draw still has a scale", () => {
    assert.deepEqual(niceScale(0).ticks, [0, 1, 2, 3]);
    assert.equal(niceScale(Number.NaN).top, 3);
  });
});

describe("amounts on a chart", () => {
  test("short: thousands as k, whole where whole", () => {
    assert.equal(shortMoney(44_825.24), "$44.8k");
    assert.equal(shortMoney(27_000), "$27k");
    assert.equal(shortMoney(15_000), "$15k");
    assert.equal(shortMoney(952.4), "$952");
    assert.equal(shortMoney(0), "$0");
    assert.equal(shortMoney(1_250_000), "$1.3M");
    assert.equal(shortMoney(-1_500), "-$1.5k");
    // 999,960 would otherwise print as "$1000k".
    assert.equal(shortMoney(999_960), "$1M");
  });

  test("whole: to the dollar", () => {
    assert.equal(wholeMoney(26_962.4), "$26,962");
    assert.equal(wholeMoney(952.5), "$953");
  });

  test("a share is a whole percentage, and a sliver is not nothing", () => {
    assert.equal(sharePercent(26_962, 80_981), "33%");
    assert.equal(sharePercent(300, 80_981), "<1%");
    assert.equal(sharePercent(0, 80_981), "");
    assert.equal(sharePercent(10, 0), "");
  });
});

describe("splitName", () => {
  test("a category path and a leaf-first name both give the leaf, then its heading", () => {
    assert.deepEqual(splitName("Meat & Poultry › Chicken"), ["Chicken", "Meat & Poultry"]);
    assert.deepEqual(splitName("Chicken · Meat & Poultry"), ["Chicken", "Meat & Poultry"]);
    assert.deepEqual(splitName("Bakery"), ["Bakery", null]);
    assert.deepEqual(splitName("Other (8)"), ["Other (8)", null]);
  });
});

describe("labelEvery", () => {
  test("every label while there is room, then evenly fewer", () => {
    assert.equal(labelEvery(7), 1);
    assert.equal(labelEvery(12), 1);
    assert.equal(labelEvery(14), 2);
    assert.equal(labelEvery(31), 3);
  });
});

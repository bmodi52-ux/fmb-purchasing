import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Comparison, MonthBreakdown } from "./aggregate.ts";
import { breakdownOn, comparisonOn, monthAxis, monthlyOn } from "./month-axis.ts";

const year = { start: "2026-07-01", end: "2027-06-30" };

describe("monthAxis", () => {
  test("every month of the range up to today, and none to come", () => {
    assert.deepEqual(
      monthAxis(year, "2026-10-02", "gregorian").map((m) => m.key),
      ["2026-07", "2026-08", "2026-09", "2026-10"]
    );
  });

  test("a range that is over has all its months; one that has not started has none", () => {
    assert.equal(monthAxis({ start: "2025-07-01", end: "2026-06-30" }, "2026-10-02", "gregorian").length, 12);
    assert.deepEqual(monthAxis({ start: "2027-07-01", end: "2028-06-30" }, "2026-10-02", "gregorian"), []);
  });

  test("a Hijri period is read by Hijri months", () => {
    // 1 Shawwal 1447 is 19 March 2026; 2 October 2026 falls in Rabi al-Aakhar 1448.
    const months = monthAxis({ start: "2026-03-19", end: "2027-03-07" }, "2026-10-02", "hijri");
    assert.equal(months.length, 7);
    assert.match(months[0].key, /^h1447-10$/);
    assert.match(months.at(-1)!.key, /^h1448-04$/);
  });
});

describe("figures on the axis", () => {
  const axis = monthAxis(year, "2026-10-02", "gregorian");
  const bucket = (key: string, spend: number) => ({ key, label: key, spend, gst: 1, count: 2 });

  test("months with nothing spent are there, at nought, and the total is unchanged", () => {
    const filled = monthlyOn(axis, [bucket("2026-07", 10), bucket("2026-09", 30)]);
    assert.deepEqual(filled.map((b) => [b.key, b.spend, b.count]), [
      ["2026-07", 10, 2],
      ["2026-08", 0, 0],
      ["2026-09", 30, 2],
      ["2026-10", 0, 0],
    ]);
    assert.equal(filled.reduce((s, b) => s + b.spend, 0), 40);
    // The label of a month that was empty is the axis's, the same style as the others'.
    assert.equal(filled[1].label, axis[1].label);
  });

  test("a receipt dated ahead of today keeps its month, in its place", () => {
    const filled = monthlyOn(axis, [bucket("2026-07", 10), bucket("2026-12", 5)]);
    assert.deepEqual(filled.map((b) => b.key), ["2026-07", "2026-08", "2026-09", "2026-10", "2026-12"]);
    assert.equal(filled.at(-1)!.spend, 5);
  });

  test("a split and a comparison move every series onto the same months", () => {
    const months = [
      { key: "2026-07", label: "Jul 26" },
      { key: "2026-09", label: "Sept 26" },
    ];
    const breakdown: MonthBreakdown = {
      months,
      series: [
        { key: "a", label: "A", values: [10, 30], total: 40 },
        { key: "b", label: "B", values: [0, 7], total: 7 },
      ],
      foldedCount: 0,
    };
    const split = breakdownOn(axis, breakdown);
    assert.equal(split.months.length, 4);
    assert.deepEqual(split.series.map((s) => s.values), [[10, 0, 30, 0], [0, 0, 7, 0]]);
    assert.deepEqual(split.series.map((s) => s.total), [40, 7]);

    const comparison: Comparison = { months, subjects: [{ key: "a", label: "A", total: 40, occurrences: 3, values: [10, 30] }], sharedMax: 30 };
    const compared = comparisonOn(axis, comparison);
    assert.deepEqual(compared.subjects[0].values, [10, 0, 30, 0]);
    assert.equal(compared.sharedMax, 30);
  });

  test("with no axis to speak of, the figures are left as they are", () => {
    const monthly = [bucket("2026-07", 10)];
    assert.deepEqual(monthlyOn([], monthly), monthly);
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { ExpenseRecord, LineRecord } from "./aggregate.ts";
import { budgetUse, isSpendingAddress, leafFirst, overdueOf, spendTrend, topOf, trendGrain } from "./dashboard.ts";
import { waiting, type MoneyExpense } from "./money-out.ts";
import { DEFAULT_PRESET, presetCode, resolveRange } from "./range-presets.ts";

describe("range presets", () => {
  test("each preset is the dates it says, as at today", () => {
    const today = "2026-10-02";
    const range = (preset: Parameters<typeof presetCode>[0]) => {
      const p = resolveRange({ range: preset }, today).period;
      return [p.start, p.end];
    };
    assert.deepEqual(range("this-month"), ["2026-10-01", "2026-10-31"]);
    assert.deepEqual(range("last-month"), ["2026-09-01", "2026-09-30"]);
    // October is the financial year's second quarter: October to December.
    assert.deepEqual(range("quarter"), ["2026-10-01", "2026-12-31"]);
    assert.deepEqual(range("fy"), ["2026-07-01", today]);
    assert.equal(range("hijri")[1], today);
  });

  test("the quarter is the financial year's, and so the BAS quarter", () => {
    assert.equal(presetCode("quarter", "2026-07-15"), "au2026-q1");
    assert.equal(presetCode("quarter", "2026-12-31"), "au2026-q2");
    assert.equal(presetCode("quarter", "2027-01-01"), "au2026-q3");
    assert.equal(presetCode("quarter", "2027-06-30"), "au2026-q4");
  });

  test("last month in January is December of the year before", () => {
    assert.equal(presetCode("last-month", "2027-01-10"), "cy2026-m12");
  });

  test("a preset is named in the address, so a bookmark moves on with the calendar", () => {
    const october = resolveRange({ range: "this-month" }, "2026-10-02").period;
    const november = resolveRange({ range: "this-month" }, "2026-11-05").period;
    assert.notEqual(october.start, november.start);
  });

  test("a period with no preset is a custom one; nothing at all is the default", () => {
    const custom = resolveRange({ period: "cy2025" }, "2026-10-02");
    assert.equal(custom.preset, "custom");
    assert.deepEqual([custom.period.start, custom.period.end], ["2025-01-01", "2025-12-31"]);
    assert.equal(resolveRange({}, "2026-10-02").preset, DEFAULT_PRESET);
    assert.equal(resolveRange({ range: "nonsense" }, "2026-10-02").preset, DEFAULT_PRESET);
    // Custom chosen before any dates: it starts from the default's, to be changed.
    assert.equal(resolveRange({ range: "custom" }, "2026-10-02").preset, "custom");
  });
});

const expense = (id: string, reportDate: string): ExpenseRecord =>
  ({
    id,
    expenseNumber: id,
    vendorId: "v",
    vendorName: "V",
    status: "paid",
    receiptDate: reportDate,
    createdAt: reportDate + "T01:00:00Z",
    reportDate,
    total: 0,
    gst: 0,
  }) as ExpenseRecord;

const line = (expenseId: string, lineTotal: number): LineRecord => ({
  expenseId,
  categoryId: "c",
  categoryName: "C",
  itemId: "i",
  itemName: "I",
  lineTotal,
  gst: 0,
  gstApportioned: false,
  quantity: 1,
});

describe("spendTrend", () => {
  test("a fortnight by the day, a quarter by the week, longer by the month", () => {
    assert.equal(trendGrain({ start: "2026-10-01", end: "2026-10-14" }), "day");
    assert.equal(trendGrain({ start: "2026-10-01", end: "2026-10-31" }), "week");
    assert.equal(trendGrain({ start: "2026-07-01", end: "2026-09-30" }), "week");
    assert.equal(trendGrain({ start: "2026-07-01", end: "2027-06-30" }), "month");
  });

  test("weeks start on Monday, the first where the range does; empty weeks are kept; the future is not drawn", () => {
    // 1 October 2026 is a Thursday.
    const slice = {
      expenses: [expense("a", "2026-10-02"), expense("b", "2026-10-13")],
      lines: [line("a", 100), line("a", 20), line("b", 50)],
    };
    const { grain, points } = spendTrend(slice, { start: "2026-10-01", end: "2026-10-31" }, "2026-10-20");
    assert.equal(grain, "week");
    assert.deepEqual(
      points.map((p) => [p.key, p.label, p.value, p.count]),
      [
        ["2026-10-01", "1 Oct", 120, 1],
        ["2026-10-05", "5 Oct", 0, 0],
        ["2026-10-12", "12 Oct", 50, 1],
        ["2026-10-19", "19 Oct", 0, 0],
      ]
    );
  });

  test("a short range is drawn by the day", () => {
    const slice = { expenses: [expense("a", "2026-10-03")], lines: [line("a", 7.5)] };
    const { grain, points } = spendTrend(slice, { start: "2026-10-01", end: "2026-10-05" }, "2026-10-30");
    assert.equal(grain, "day");
    assert.deepEqual(points.map((p) => p.value), [0, 0, 7.5, 0, 0]);
  });

  test("a long range is drawn by the month: every month so far, empty or not, and none to come", () => {
    const slice = {
      expenses: [expense("a", "2026-07-03"), expense("b", "2026-09-10")],
      lines: [line("a", 10), line("b", 30)],
    };
    const { grain, points } = spendTrend(slice, { start: "2026-07-01", end: "2027-06-30" }, "2026-10-02");
    assert.equal(grain, "month");
    assert.deepEqual(
      points.map((p) => [p.key, p.value, p.count]),
      [
        ["2026-07", 10, 1],
        ["2026-08", 0, 0],
        ["2026-09", 30, 1],
        ["2026-10", 0, 0],
      ]
    );
  });

  test("the month today is in is under way; a month that is over is not, nor a range that has ended", () => {
    const year = { start: "2026-07-01", end: "2027-06-30" };
    const none = { expenses: [], lines: [] };
    assert.deepEqual(spendTrend(none, year, "2026-10-02").points.map((p) => p.underWay), [false, false, false, true]);
    // On the last day of a month there is no more of it to come.
    assert.deepEqual(spendTrend(none, year, "2026-09-30").points.map((p) => p.underWay), [false, false, false]);
    // Last year, looked at from this one.
    assert.ok(spendTrend(none, { start: "2025-07-01", end: "2026-06-30" }, "2026-10-02").points.every((p) => !p.underWay));
    // A week: Friday 2 October is in a week that runs to Sunday the 4th.
    assert.deepEqual(spendTrend(none, { start: "2026-09-01", end: "2026-10-31" }, "2026-10-02").points.at(-1)?.underWay, true);
    // "So far this year" ends today by definition; its last month is still only part of one.
    assert.equal(spendTrend(none, { start: "2026-07-01", end: "2026-10-02" }, "2026-10-02").points.at(-1)?.underWay, true);
    // Days are never marked: a day is one figure, not part of one.
    assert.ok(spendTrend(none, { start: "2026-10-01", end: "2026-10-07" }, "2026-10-02").points.every((p) => !p.underWay));
  });

  test("each month is marked against the same month of the period before", () => {
    const now = { expenses: [expense("a", "2026-07-03"), expense("b", "2026-08-10")], lines: [line("a", 10), line("b", 30)] };
    const then = { expenses: [expense("x", "2025-07-20"), expense("y", "2025-09-01")], lines: [line("x", 7), line("y", 99)] };
    const { points } = spendTrend(now, { start: "2026-07-01", end: "2027-06-30" }, "2026-08-31", "gregorian", {
      slice: then,
      // The same stretch of last year: July and August.
      range: { start: "2025-07-01", end: "2025-08-31" },
    });
    assert.deepEqual(points.map((p) => [p.key, p.value, p.compare]), [["2026-07", 10, 7], ["2026-08", 30, 0]]);
  });

  test("weeks are marked against the same days counted from the start, whatever weekday they fall on", () => {
    // September 2026 starts on a Tuesday, August on a Saturday.
    const now = { expenses: [expense("a", "2026-09-02")], lines: [line("a", 50)] };
    const then = { expenses: [expense("x", "2026-08-03"), expense("y", "2026-08-08")], lines: [line("x", 5), line("y", 8)] };
    const { points } = spendTrend(now, { start: "2026-09-01", end: "2026-09-30" }, "2026-10-02", "gregorian", {
      slice: then,
      range: { start: "2026-08-01", end: "2026-08-31" },
    });
    // The first week is 1–6 September, six days: 1–6 August holds the 3rd, not the 8th.
    assert.deepEqual(points.slice(0, 2).map((p) => [p.key, p.value, p.compare]), [["2026-09-01", 50, 5], ["2026-09-07", 0, 8]]);
  });

  test("months within a year are named without it; across more than a year they keep it", () => {
    const none = { expenses: [], lines: [] };
    assert.deepEqual(
      spendTrend(none, { start: "2026-07-01", end: "2027-06-30" }, "2026-09-30").points.map((p) => p.label),
      ["Jul", "Aug", "Sep"]
    );
    const long = spendTrend(none, { start: "2025-07-01", end: "2026-09-30" }, "2026-10-02").points;
    assert.equal(long.length, 15);
    assert.equal(long[0].label, "Jul 2025");
  });

  test("with no period before given, nothing is marked", () => {
    const { points } = spendTrend({ expenses: [], lines: [] }, { start: "2026-07-01", end: "2027-06-30" }, "2026-10-02");
    assert.ok(points.every((p) => p.compare === null));
  });

  test("the points add up to the slice", () => {
    const slice = {
      expenses: [expense("a", "2026-10-02"), expense("b", "2026-10-13")],
      lines: [line("a", 100.1), line("b", 50.2)],
    };
    const { points } = spendTrend(slice, { start: "2026-10-01", end: "2026-10-31" }, "2026-10-31");
    assert.equal(Math.round(points.reduce((s, p) => s + p.value, 0) * 100) / 100, 150.3);
  });
});

describe("topOf", () => {
  test("the ten largest, largest first; a discount is not something bought most", () => {
    const buckets = Array.from({ length: 12 }, (_, i) => ({ key: "k" + i, label: "L" + i, spend: i * 10, gst: 0, count: 1 }));
    buckets.push({ key: "d", label: "Discount", spend: -40, gst: 0, count: 2 });
    const top = topOf(buckets);
    assert.equal(top.length, 10);
    assert.deepEqual([top[0].label, top[0].value], ["L11", 110]);
    assert.ok(top.every((t) => t.value > 0));
  });

  test("a category under a heading is named by itself first, so two under one heading can be told apart when cut short", () => {
    assert.equal(leafFirst("Meat & Poultry › Chicken"), "Chicken · Meat & Poultry");
    assert.equal(leafFirst("Groceries"), "Groceries");
    const top = topOf([{ key: "c", label: "Meat & Poultry › Chicken", spend: 5, gst: 0, count: 1 }]);
    assert.equal(top[0].label, "Chicken · Meat & Poultry");
  });
});

let n = 0;
const approved = (decidedOn: string, total: number): MoneyExpense => {
  n += 1;
  return {
    id: "m" + n,
    entry: "E-" + n,
    status: "approved",
    vendor: "V",
    vendorKey: "v",
    payee: "P",
    total,
    submittedOn: decidedOn,
    decidedOn,
    paidOn: null,
    runId: null,
    runNumber: null,
    reference: null,
    bankConfirmedOn: null,
  };
};

describe("overdueOf", () => {
  const today = "2026-10-20";
  const w = waiting(
    [approved("2026-10-19", 10), approved("2026-10-13", 20), approved("2026-10-12", 40), approved("2026-09-01", 80)],
    (e) => e.decidedOn,
    today
  );

  test("overdue is waiting longer than the reminder's escalation, not as long as", () => {
    // Waiting 1, 7, 8 and 49 days; overdue after 7.
    const o = overdueOf(w, 7);
    assert.deepEqual([o.count, o.amount, o.oldestDays], [2, 120, 49]);
    assert.deepEqual([o.waitingCount, o.waitingAmount, o.afterDays], [4, 150, 7]);
  });

  test("nothing overdue has no oldest", () => {
    const o = overdueOf(w, 60);
    assert.deepEqual([o.count, o.amount, o.oldestDays], [0, 0, null]);
  });
});

describe("budgetUse", () => {
  test("spend in budgeted categories over what was budgeted", () => {
    const u = budgetUse({ budgeted: 1000, spentAgainstBudgets: 250, remaining: 750, paid: 100, committed: 400 });
    assert.deepEqual([u.used, u.remaining], [0.25, 750]);
  });

  test("with nothing budgeted there is no percentage, rather than a division by nought", () => {
    assert.equal(budgetUse({ budgeted: 0, spentAgainstBudgets: 0, remaining: null, paid: 0, committed: 0 }).used, null);
  });
});

describe("isSpendingAddress", () => {
  test("an old /reports link with a section or a filter meant the Spending report", () => {
    assert.equal(isSpendingAddress({ section: "breakdown", period: "h1447" }), true);
    assert.equal(isSpendingAddress({ vendor: ["a", "b"] }), true);
    assert.equal(isSpendingAddress({ status: "paid" }), true);
  });

  test("a period or a range alone is the dashboard's", () => {
    assert.equal(isSpendingAddress({ period: "h1447" }), false);
    assert.equal(isSpendingAddress({ range: "this-month" }), false);
    assert.equal(isSpendingAddress({}), false);
  });
});

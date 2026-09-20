import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isWholeWeek, rangeFromParams, shiftWeeks, weekLabel, weekOf } from "./buying-week";

describe("weekOf", () => {
  test("a Monday is the start of its own week", () => {
    assert.deepEqual(weekOf("2026-09-21"), { from: "2026-09-21", to: "2026-09-27" });
  });

  test("a Thursday belongs to the Monday before it", () => {
    assert.deepEqual(weekOf("2026-09-24"), { from: "2026-09-21", to: "2026-09-27" });
  });

  test("Sunday belongs to the week just gone, not the one starting tomorrow", () => {
    assert.deepEqual(weekOf("2026-09-27"), { from: "2026-09-21", to: "2026-09-27" });
  });

  test("a week that crosses the end of a month still runs Monday to Sunday", () => {
    assert.deepEqual(weekOf("2026-10-01"), { from: "2026-09-28", to: "2026-10-04" });
  });
});

describe("shiftWeeks", () => {
  const week = { from: "2026-09-21", to: "2026-09-27" };

  test("back a week", () => {
    assert.deepEqual(shiftWeeks(week, -1), { from: "2026-09-14", to: "2026-09-20" });
  });

  test("forward a week", () => {
    assert.deepEqual(shiftWeeks(week, 1), { from: "2026-09-28", to: "2026-10-04" });
  });

  test("a range that is not a week moves by seven days all the same", () => {
    assert.deepEqual(shiftWeeks({ from: "2026-09-21", to: "2026-10-04" }, 1), {
      from: "2026-09-28",
      to: "2026-10-11",
    });
  });

  test("crossing a year", () => {
    assert.deepEqual(shiftWeeks({ from: "2026-12-28", to: "2027-01-03" }, 1), {
      from: "2027-01-04",
      to: "2027-01-10",
    });
  });
});

describe("isWholeWeek", () => {
  test("Monday to Sunday", () => {
    assert.equal(isWholeWeek({ from: "2026-09-21", to: "2026-09-27" }), true);
  });

  test("a fortnight is not a week", () => {
    assert.equal(isWholeWeek({ from: "2026-09-21", to: "2026-10-04" }), false);
  });

  test("seven days that start on a Wednesday are not a week either", () => {
    assert.equal(isWholeWeek({ from: "2026-09-23", to: "2026-09-29" }), false);
  });
});

describe("weekLabel", () => {
  const today = "2026-09-24"; // a Thursday

  test("the week today falls in", () => {
    assert.equal(weekLabel({ from: "2026-09-21", to: "2026-09-27" }, today), "This week");
  });

  test("either side of it", () => {
    assert.equal(weekLabel({ from: "2026-09-14", to: "2026-09-20" }, today), "Last week");
    assert.equal(weekLabel({ from: "2026-09-28", to: "2026-10-04" }, today), "Next week");
  });

  test("further off, in weeks", () => {
    assert.equal(weekLabel({ from: "2026-10-05", to: "2026-10-11" }, today), "In 2 weeks");
    assert.equal(weekLabel({ from: "2026-09-07", to: "2026-09-13" }, today), "2 weeks ago");
  });

  test("anything else says so rather than pretending to be a week", () => {
    assert.equal(weekLabel({ from: "2026-09-21", to: "2026-10-04" }, today), "Custom range");
  });
});

describe("rangeFromParams", () => {
  const today = "2026-09-24";

  test("nothing asked for opens on this week", () => {
    assert.deepEqual(rangeFromParams({}, today), { from: "2026-09-21", to: "2026-09-27" });
  });

  test("a range asked for is honoured, week or not", () => {
    assert.deepEqual(rangeFromParams({ from: "2026-09-01", to: "2026-09-30" }, today), {
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  test("half a range is no range", () => {
    assert.deepEqual(rangeFromParams({ from: "2026-09-01" }, today), { from: "2026-09-21", to: "2026-09-27" });
  });

  test("a range that runs backwards is refused rather than shown empty", () => {
    assert.deepEqual(rangeFromParams({ from: "2026-09-30", to: "2026-09-01" }, today), {
      from: "2026-09-21",
      to: "2026-09-27",
    });
  });

  test("nonsense in the URL is ignored", () => {
    assert.deepEqual(rangeFromParams({ from: "last tuesday", to: "soon" }, today), {
      from: "2026-09-21",
      to: "2026-09-27",
    });
  });
});

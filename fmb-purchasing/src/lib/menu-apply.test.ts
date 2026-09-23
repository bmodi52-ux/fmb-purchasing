import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cleanDates, describeSummary, emptySummary, needsUnrelease, outcomeFor, type TargetDay } from "./menu-apply.ts";

const empty: TargetDay = { exists: false, hasContent: false, released: false, bought: false };
const planned: TargetDay = { exists: true, hasContent: true, released: false, bought: false };
const released: TargetDay = { ...planned, released: true };
const bought: TargetDay = { ...released, bought: true };

describe("what happens on each picked day", () => {
  test("an empty day gets the menu whatever was chosen", () => {
    for (const choice of ["skip", "add", "replace"] as const) {
      assert.equal(outcomeFor(empty, choice), "fill");
      // A row with nothing on it, as a day gets once anyone saves a count.
      assert.equal(outcomeFor({ ...empty, exists: true }, choice), "fill");
    }
  });

  test("a day with a menu follows the choice", () => {
    assert.equal(outcomeFor(planned, "skip"), "skip_has_menu");
    assert.equal(outcomeFor(planned, "add"), "add");
    assert.equal(outcomeFor(planned, "replace"), "replace");
  });

  test("a day already bought for is never replaced", () => {
    assert.equal(outcomeFor(bought, "replace"), "skip_bought");
    // Adding to it is allowed: what was bought stays bought.
    assert.equal(outcomeFor(bought, "add"), "add");
  });

  test("a released day that changes goes back to draft", () => {
    assert.equal(needsUnrelease(released, "add"), true);
    assert.equal(needsUnrelease(released, "replace"), true);
    assert.equal(needsUnrelease(released, "skip_has_menu"), false);
    assert.equal(needsUnrelease(planned, "replace"), false);
  });
});

describe("picked dates", () => {
  test("keeps real dates, once each, in order", () => {
    assert.deepEqual(cleanDates(["2026-10-02", "2026-10-01", "2026-10-02"]), ["2026-10-01", "2026-10-02"]);
  });

  test("drops anything that is not a date", () => {
    assert.deepEqual(cleanDates(["2026-02-30", "tomorrow", "", "2026-13-01", "2026-09-30"]), ["2026-09-30"]);
  });
});

describe("the sentence afterwards", () => {
  test("says how many days, and what was left alone", () => {
    const s = { ...emptySummary(), fill: 3, skip_has_menu: 1 };
    assert.equal(describeSummary(s), "Put on 3 days, left 1 that already had a menu.");
  });

  test("says which days need releasing again", () => {
    const s = { ...emptySummary(), fill: 1, replace: 1, unreleased: 1 };
    assert.equal(
      describeSummary(s),
      "Put on 2 days, replaced the menu on 1. 1 was released and is back to draft, to release again."
    );
  });
});

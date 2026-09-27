import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { describePriceAge, isOldPrice, priceAgeDays } from "./price-age.ts";

describe("price age (#30)", () => {
  test("days between the price's date and today", () => {
    assert.equal(priceAgeDays("2026-07-29", "2026-09-27"), 60);
    assert.equal(priceAgeDays("2026-09-27T00:00:00+00:00", "2026-09-27"), 0);
    assert.equal(priceAgeDays(null, "2026-09-27"), null);
    assert.equal(priceAgeDays("-infinity", "2026-09-27"), null);
  });

  test("old means past 60 days", () => {
    assert.equal(isOldPrice("2026-07-29", "2026-09-27"), false);
    assert.equal(isOldPrice("2026-07-28", "2026-09-27"), true);
    assert.equal(isOldPrice(null, "2026-09-27"), false);
  });

  test("said the way a person would", () => {
    assert.equal(describePriceAge(61), "61 days old");
    assert.equal(describePriceAge(130), "4 months old");
    assert.equal(describePriceAge(400), "over a year old");
  });
});

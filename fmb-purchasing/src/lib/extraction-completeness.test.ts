import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { closerToTotal, linesShortfall } from "./extraction-completeness";

const lines = (...totals: (number | null)[]) => totals.map((lineTotal) => ({ lineTotal }));

describe("linesShortfall", () => {
  test("the BLF & MIX reading: four lines of eighteen", () => {
    assert.equal(linesShortfall({ total: 2737, lineItems: lines(660, 330, 40, 240) }), 1467);
  });

  test("lines that add up, or nearly, are left alone", () => {
    assert.equal(linesShortfall({ total: 2737, lineItems: lines(2737) }), null);
    assert.equal(linesShortfall({ total: 100, lineItems: lines(99.44) }), null, "a card surcharge's worth");
    assert.equal(linesShortfall({ total: 1000, lineItems: lines(985) }), null, "under 2%");
  });

  test("lines over the total aren't a shortfall", () => {
    assert.equal(linesShortfall({ total: 100, lineItems: lines(150) }), null);
  });

  test("no total, nothing to compare with", () => {
    assert.equal(linesShortfall({ total: null, lineItems: lines(10) }), null);
  });

  test("unreadable line totals count as nothing", () => {
    assert.equal(linesShortfall({ total: 50, lineItems: lines(null, 20) }), 30);
  });
});

describe("closerToTotal", () => {
  test("keeps whichever reading comes closer", () => {
    const four = { total: 2737, lineItems: lines(660, 330, 40, 240) };
    const all = { total: 2737, lineItems: lines(2627) };
    assert.equal(closerToTotal(four, all), all);
    assert.equal(closerToTotal(all, four), all);
  });
});

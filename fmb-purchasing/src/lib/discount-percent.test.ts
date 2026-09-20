import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { discountAmount, discountBase } from "./discount-percent";
import type { MoneyLine } from "./expense-money";

const line = (kind: MoneyLine["kind"], lineTotal: number): MoneyLine => ({ kind, lineTotal, gstApplicable: false });

describe("discountAmount (#62)", () => {
  // Radhe: SUBTOTAL 92.00 / 10% DISCOUNT 9.20- / TOTAL 82.80
  test("10% of what was bought", () => {
    assert.equal(discountAmount([line("goods", 92)], 10), -9.2);
  });

  test("charges are not discounted, and neither is another discount", () => {
    const lines = [line("goods", 100), line("service", 50), line("surcharge", 2), line("discount", -5)];
    assert.equal(discountBase(lines), 150);
    assert.equal(discountAmount(lines, 5), -7.5);
  });

  test("rounded to the cent", () => {
    assert.equal(discountAmount([line("goods", 1490.24)], 5), -74.51);
    assert.equal(discountAmount([line("goods", 33.33)], 7.5), -2.5);
  });

  test("nothing to work from returns null", () => {
    assert.equal(discountAmount([line("goods", 100)], null), null);
    assert.equal(discountAmount([line("goods", 100)], 0), null);
    assert.equal(discountAmount([line("surcharge", 2)], 10), null, "no goods or services yet");
    assert.equal(discountAmount([line("goods", -20)], 10), null, "a credit-only receipt");
  });
});

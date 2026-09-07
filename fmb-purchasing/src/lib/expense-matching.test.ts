import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isWorthRemembering, unitPriceFromLine, offerPackPrice } from "./expense-matching.ts";

/**
 * Which submitter edits teach the app a new receipt wording.
 *
 * A correction used to be recorded only as its outcome — the tidy text a human
 * typed was remembered against the item, and the misreading that made them
 * type it was thrown away. The same vendor printing the same awkward text next
 * month then failed to match all over again, however many times somebody had
 * already fixed it.
 */
describe("isWorthRemembering", () => {
  test("remembers a genuine correction", () => {
    assert.equal(isWorthRemembering("Chckn Thgh 5Kg", "Chicken Thigh 5kg"), true);
  });

  test("ignores a line the submitter left exactly as read", () => {
    assert.equal(isWorthRemembering("Chicken Thigh 5kg", "Chicken Thigh 5kg"), false);
  });

  test("ignores a case-only edit", () => {
    // Matching normalizes case, so this would have matched regardless.
    assert.equal(isWorthRemembering("CHICKEN THIGH", "Chicken Thigh"), false);
  });

  test("ignores a whitespace-only edit", () => {
    assert.equal(isWorthRemembering("Chicken   Thigh  ", "Chicken Thigh"), false);
  });

  test("ignores manually entered lines, which have no earlier reading", () => {
    assert.equal(isWorthRemembering(null, "Chicken Thigh"), false);
    assert.equal(isWorthRemembering(undefined, "Chicken Thigh"), false);
  });

  test("ignores an original that was blank or only spaces", () => {
    assert.equal(isWorthRemembering("", "Chicken Thigh"), false);
    assert.equal(isWorthRemembering("   ", "Chicken Thigh"), false);
  });

  test("remembers when a submitter replaces the description entirely", () => {
    // Extraction sometimes grabs a heading or a code rather than the product.
    assert.equal(isWorthRemembering("ITEM 4", "Basmati Rice 20kg"), true);
  });

  test("remembers a correction that only adds detail", () => {
    assert.equal(isWorthRemembering("Chicken", "Chicken Thigh 5kg"), true);
  });
});

/**
 * The price a receipt line puts on the offer it creates.
 *
 * Every offer a receipt created used to arrive with no price at all, so the
 * figure printed on the receipt had to be typed back in by hand on the item
 * page before the item was worth anything to anyone.
 */
describe("unitPriceFromLine", () => {
  test("prices one unit, not the whole line", () => {
    assert.equal(unitPriceFromLine({ lineTotal: 48, quantity: 4, normalizedQuantity: 4 }), 12);
  });

  test("prefers the normalized quantity, since that is the pack size's unit", () => {
    // "2000 g" normalizes to 2 kg, and the pack size created alongside is
    // 1 kg — so the offer wants $4.00/kg, not $0.004/g.
    assert.equal(unitPriceFromLine({ lineTotal: 8, quantity: 2000, normalizedQuantity: 2 }), 4);
  });

  test("falls back to the raw quantity when nothing was normalized", () => {
    assert.equal(unitPriceFromLine({ lineTotal: 30, quantity: 3, normalizedQuantity: null }), 10);
  });

  test("rounds to what the column can hold", () => {
    // pack_price is numeric(12, 4); anything finer is lost on the way in.
    assert.equal(unitPriceFromLine({ lineTotal: 10, quantity: 3, normalizedQuantity: null }), 3.3333);
  });

  test("gives no price when the quantity was never read", () => {
    assert.equal(unitPriceFromLine({ lineTotal: 48, quantity: null, normalizedQuantity: null }), null);
  });

  test("gives no price for a zero quantity rather than dividing by it", () => {
    assert.equal(unitPriceFromLine({ lineTotal: 48, quantity: 0, normalizedQuantity: 0 }), null);
  });

  test("gives no price for a credit or refund line", () => {
    // A negative pack price is not a price anyone can act on.
    assert.equal(unitPriceFromLine({ lineTotal: -48, quantity: 4, normalizedQuantity: 4 }), null);
  });

  test("gives no price for a free line", () => {
    assert.equal(unitPriceFromLine({ lineTotal: 0, quantity: 4, normalizedQuantity: 4 }), null);
  });

  test("gives no price for a negative quantity", () => {
    assert.equal(unitPriceFromLine({ lineTotal: 48, quantity: -4, normalizedQuantity: -4 }), null);
  });

  test("handles a fractional quantity", () => {
    assert.equal(unitPriceFromLine({ lineTotal: 15, quantity: 1.5, normalizedQuantity: 1.5 }), 10);
  });
});

/**
 * The price recorded against an offer, for the pack that offer is sold in.
 *
 * pack_price means the price of the whole pack, so a per-unit figure written
 * there would read as a fraction of the real cost once divided by the pack's
 * contents — 12 cents a kilo for rice that cost $2.40.
 */
describe("offerPackPrice", () => {
  const rice = { innerQuantity: 5, unitCode: "kg", packCount: 4 };

  test("falls back to the unit price when no pack is stated", () => {
    assert.equal(
      offerPackPrice({ lineTotal: 48, quantity: 20, normalizedQuantity: 20 }, null),
      2.4
    );
  });

  test("prices the whole pack when the line is counted in the pack's unit", () => {
    // 20 kg for $48 is $2.40/kg, and one 5 kg × 4 carton holds 20 kg.
    assert.equal(
      offerPackPrice(
        { lineTotal: 48, quantity: 20, normalizedQuantity: 20, normalizedUnit: "kg" },
        rice
      ),
      48
    );
  });

  test("still prices one pack when several were bought", () => {
    assert.equal(
      offerPackPrice(
        { lineTotal: 96, quantity: 40, normalizedQuantity: 40, normalizedUnit: "kg" },
        rice
      ),
      48
    );
  });

  test("divides by the packs bought when the line counts packs", () => {
    // "Ghee 12x500g", 2 cartons for $120 — the quantity is in cartons, not
    // grams, so the line total over the count is already the pack price.
    assert.equal(
      offerPackPrice(
        { lineTotal: 120, quantity: 2, normalizedQuantity: 2, normalizedUnit: "ea" },
        { innerQuantity: 500, unitCode: "g", packCount: 12 }
      ),
      60
    );
  });

  test("treats a unit it cannot read as counting packs", () => {
    assert.equal(
      offerPackPrice({ lineTotal: 60, quantity: 1, normalizedQuantity: null }, rice),
      60
    );
  });

  test("accepts the spelling the invoice used for the unit", () => {
    assert.equal(
      offerPackPrice(
        { lineTotal: 48, quantity: 20, normalizedQuantity: 20, normalizedUnit: "KGS" },
        rice
      ),
      48
    );
  });

  test("gives no price for a credit line, pack or not", () => {
    assert.equal(
      offerPackPrice(
        { lineTotal: -48, quantity: 20, normalizedQuantity: 20, normalizedUnit: "kg" },
        rice
      ),
      null
    );
    assert.equal(offerPackPrice({ lineTotal: -48, quantity: 1, normalizedQuantity: 1 }, rice), null);
  });

  test("gives no price when nothing says how many packs were bought", () => {
    assert.equal(
      offerPackPrice({ lineTotal: 48, quantity: 0, normalizedQuantity: null }, rice),
      null
    );
  });
});

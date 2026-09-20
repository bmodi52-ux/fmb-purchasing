import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { packDefaultsForLine, packFromFields } from "./new-pack";

const UNITS = [
  { id: "u-kg", code: "kg", label: "kg" },
  { id: "u-ea", code: "ea", label: "ea" },
];

describe("packFromFields (#60)", () => {
  test("a box of 3 kg", () => {
    assert.deepEqual(packFromFields({ soldAs: "box", innerQuantity: "3", innerUnitId: "u-kg", packCount: "1" }), {
      soldAs: "box",
      innerQuantity: 3,
      innerUnitId: "u-kg",
      packCount: 1,
    });
  });

  test("loose is one unit, whatever the fields say", () => {
    assert.deepEqual(packFromFields({ soldAs: "loose", innerQuantity: "7", innerUnitId: "u-kg", packCount: "4" }), {
      soldAs: "loose",
      innerQuantity: 1,
      innerUnitId: "u-kg",
      packCount: 1,
    });
  });

  test("a carton of 12 × 1 L", () => {
    const p = packFromFields({ soldAs: "carton", innerQuantity: "1", innerUnitId: "u-ea", packCount: "12" });
    assert.equal(p?.packCount, 12);
  });

  test("unusable until it says how much and in what", () => {
    assert.equal(packFromFields(null), null);
    assert.equal(packFromFields({ soldAs: "box", innerQuantity: "3", innerUnitId: "", packCount: "1" }), null);
    assert.equal(packFromFields({ soldAs: "box", innerQuantity: "", innerUnitId: "u-kg", packCount: "1" }), null);
    assert.equal(packFromFields({ soldAs: "box", innerQuantity: "0", innerUnitId: "u-kg", packCount: "1" }), null);
    assert.equal(packFromFields({ soldAs: "box", innerQuantity: "-3", innerUnitId: "u-kg", packCount: "1" }), null);
  });
});

describe("packDefaultsForLine (#60)", () => {
  test("the Urid Gota line: 8 at 24 kg is 3 kg each", () => {
    assert.deepEqual(packDefaultsForLine({ quantity: 8, normalizedQuantity: 24, normalizedUnit: "kg" }, UNITS), {
      soldAs: "",
      innerQuantity: "3",
      innerUnitId: "u-kg",
      packCount: "1",
    });
  });

  test("falls back to one of the item's own unit when the line doesn't say", () => {
    assert.deepEqual(packDefaultsForLine({ quantity: null, normalizedQuantity: null, normalizedUnit: null }, UNITS), {
      soldAs: "",
      innerQuantity: "1",
      innerUnitId: "",
      packCount: "1",
    });
  });

  test("a unit the Pricelist doesn't have is left to be chosen", () => {
    assert.equal(packDefaultsForLine({ quantity: 2, normalizedQuantity: 10, normalizedUnit: "L" }, UNITS).innerUnitId, "");
  });
});

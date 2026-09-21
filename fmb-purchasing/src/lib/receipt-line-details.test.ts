import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lineDetailsFrom, packShapeFromDetails } from "./receipt-line-details.ts";

describe("lineDetailsFrom", () => {
  test("a supermarket line: brand and size", () => {
    assert.deepEqual(
      lineDetailsFrom({
        brand: "Mainland",
        productCode: null,
        packaging: "bag",
        packSize: { innerQuantity: 2, unit: "kg", packCount: 1 },
      }),
      { brand: "Mainland", productCode: null, packaging: "bag", packInnerQuantity: 2, packUnit: "kg", packCount: 1 }
    );
  });

  test("a wholesale line: code and a carton of bottles", () => {
    const details = lineDetailsFrom({
      brand: null,
      productCode: " 10432 ",
      packaging: "carton",
      packSize: { innerQuantity: 1, unit: "L", packCount: 10 },
    });
    assert.equal(details?.productCode, "10432");
    assert.deepEqual(packShapeFromDetails(details), { innerQuantity: 1, unitCode: "L", packCount: 10 });
  });

  test("each is counted in items", () => {
    assert.equal(
      lineDetailsFrom({ packaging: "tray", packSize: { innerQuantity: 30, unit: "each", packCount: 1 } })?.packUnit,
      "ea"
    );
  });

  test("unclear packaging and no pack say nothing", () => {
    assert.equal(lineDetailsFrom({ brand: null, productCode: null, packaging: "unclear", packSize: null }), null);
  });

  test("a pack out of bounds is dropped, the rest kept", () => {
    const details = lineDetailsFrom({
      brand: "Tilda",
      packaging: "sack",
      packSize: { innerQuantity: 5000, unit: "kg", packCount: 1 },
    });
    assert.equal(details?.brand, "Tilda");
    assert.equal(details?.packInnerQuantity, null);
    assert.equal(packShapeFromDetails(details), null);
  });

  test("a fractional count is not a pack", () => {
    assert.equal(
      lineDetailsFrom({ packSize: { innerQuantity: 1, unit: "kg", packCount: 2.5 } }),
      null
    );
  });
});

describe("packShapeFromDetails", () => {
  test("loose goods are one unit of what they are priced by", () => {
    assert.deepEqual(
      packShapeFromDetails({
        brand: null,
        productCode: null,
        packaging: "loose",
        packInnerQuantity: 1,
        packUnit: "kg",
        packCount: 1,
      }),
      { innerQuantity: 1, unitCode: "kg", packCount: 1 }
    );
  });

  test("nothing stated, nothing read", () => {
    assert.equal(packShapeFromDetails(null), null);
  });
});

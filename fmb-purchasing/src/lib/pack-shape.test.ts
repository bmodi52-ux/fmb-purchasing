import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { packShapeFromDescription } from "./pack-shape.ts";

/**
 * Reading the pack a vendor describes off the line itself.
 *
 * A wrong pack size is worse than none — it divides every per-unit comparison
 * by the wrong number, quietly — so most of these tests are about what it
 * refuses to read.
 */
describe("packShapeFromDescription", () => {
  test("reads a plain weight", () => {
    assert.deepEqual(packShapeFromDescription("Basmati Rice 5kg"), {
      innerQuantity: 5,
      unitCode: "kg",
      packCount: 1,
    });
  });

  test("reads a quantity followed by a pack count", () => {
    assert.deepEqual(packShapeFromDescription("Chef's Tasty Choice Rice 5kg x 4"), {
      innerQuantity: 5,
      unitCode: "kg",
      packCount: 4,
    });
  });

  test("reads a pack count followed by a quantity", () => {
    assert.deepEqual(packShapeFromDescription("4 x 5kg Rice"), {
      innerQuantity: 5,
      unitCode: "kg",
      packCount: 4,
    });
  });

  test("accepts the multiplication sign and the asterisk", () => {
    assert.deepEqual(packShapeFromDescription("Milk 1L × 10"), {
      innerQuantity: 1,
      unitCode: "L",
      packCount: 10,
    });
    assert.deepEqual(packShapeFromDescription("Milk 1L*10"), {
      innerQuantity: 1,
      unitCode: "L",
      packCount: 10,
    });
  });

  test("normalizes the unit spelling the invoice used", () => {
    assert.equal(packShapeFromDescription("Chicken Thigh 2 KGS")?.unitCode, "kg");
    assert.equal(packShapeFromDescription("Oil 20 Litres")?.unitCode, "L");
    assert.equal(packShapeFromDescription("Sauce 500 gms")?.unitCode, "g");
    assert.equal(packShapeFromDescription("Cans 375ML")?.unitCode, "mL");
  });

  test("reads a fractional quantity", () => {
    assert.deepEqual(packShapeFromDescription("Cream 1.5L"), {
      innerQuantity: 1.5,
      unitCode: "L",
      packCount: 1,
    });
  });

  test("copes with no space before the unit", () => {
    assert.equal(packShapeFromDescription("Ghee 12x500g")?.packCount, 12);
    assert.equal(packShapeFromDescription("Ghee 12x500g")?.innerQuantity, 500);
  });

  test("says nothing when the description states no pack", () => {
    assert.equal(packShapeFromDescription("Chicken Thigh"), null);
    assert.equal(packShapeFromDescription("Monthly kitchen deep clean"), null);
    assert.equal(packShapeFromDescription(""), null);
    assert.equal(packShapeFromDescription(null), null);
  });

  test("ignores a number with no unit attached", () => {
    // A product code or a year is not a pack size.
    assert.equal(packShapeFromDescription("Rice 2019"), null);
    assert.equal(packShapeFromDescription("ITEM 4"), null);
  });

  test("refuses counts, which say nothing about what one holds", () => {
    // "12 eggs" or "12 trays of thirty"? Only a person can say, and until they
    // do, any per-unit figure derived from it is a guess.
    assert.equal(packShapeFromDescription("Eggs 12 pcs"), null);
    assert.equal(packShapeFromDescription("Trays 12 each"), null);
    assert.equal(packShapeFromDescription("Soft drink 24 cans"), null);
  });

  test("refuses a pack count too large to be a pack", () => {
    assert.equal(packShapeFromDescription("Rice 5kg x 5000"), null);
  });

  test("refuses an inner quantity too large to be one unit's contents", () => {
    // 80 kg is what was bought, not how it is sold.
    assert.equal(packShapeFromDescription("Chicken 5000kg"), null);
  });

  test("does not read a fractional pack count as a whole one", () => {
    // "x 2.5" is not a pack of two. The unit it does state is still read, and
    // a pack count of one is the conservative reading of the rest.
    assert.deepEqual(packShapeFromDescription("Rice 5kg x 2.5"), {
      innerQuantity: 5,
      unitCode: "kg",
      packCount: 1,
    });
  });

  test("refuses a zero quantity", () => {
    assert.equal(packShapeFromDescription("Rice 0kg"), null);
  });

  test("takes the first shape when a description states two", () => {
    // Whichever comes first is the product; anything after is usually a note
    // about the case it ships in, which a person can correct.
    assert.deepEqual(packShapeFromDescription("Rice 5kg x 4 (20kg total)"), {
      innerQuantity: 5,
      unitCode: "kg",
      packCount: 4,
    });
  });

  test("does not read a unit out of the middle of a word", () => {
    assert.equal(packShapeFromDescription("Product 5kglobe"), null);
    assert.equal(packShapeFromDescription("Batch 20 great value"), null);
  });
});

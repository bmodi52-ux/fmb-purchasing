import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { canonicalUnitCode } from "./units.ts";

/**
 * Unit normalisation is the first step of the costing chain: a receipt says
 * "kgs" or "Litres", and if that doesn't resolve to a canonical code the
 * line either falls back to the item's own unit or drops out of per-unit
 * reporting. Getting it wrong is silent, so it's worth pinning down.
 */
describe("canonicalUnitCode", () => {
  test("maps every mass spelling onto kg or g", () => {
    for (const raw of ["kg", "kgs", "Kilo", "KILOS", "kilogram", "kilograms"]) {
      assert.equal(canonicalUnitCode(raw), "kg", `${raw} should be kg`);
    }
    for (const raw of ["g", "gm", "gms", "gram", "Grams"]) {
      assert.equal(canonicalUnitCode(raw), "g", `${raw} should be g`);
    }
  });

  test("maps every volume spelling onto L or mL", () => {
    for (const raw of ["l", "L", "lt", "ltr", "ltrs", "litre", "Litres", "liter", "liters"]) {
      assert.equal(canonicalUnitCode(raw), "L", `${raw} should be L`);
    }
    for (const raw of ["ml", "mls", "millilitre", "Millilitres", "milliliter", "milliliters"]) {
      assert.equal(canonicalUnitCode(raw), "mL", `${raw} should be mL`);
    }
  });

  test("maps every count spelling onto ea", () => {
    for (const raw of ["ea", "each", "pc", "pcs", "piece", "Pieces", "unit", "units"]) {
      assert.equal(canonicalUnitCode(raw), "ea", `${raw} should be ea`);
    }
  });

  test("maps carton spellings onto carton", () => {
    for (const raw of ["carton", "cartons", "ctn", "ctns", "case", "Cases"]) {
      assert.equal(canonicalUnitCode(raw), "carton", `${raw} should be carton`);
    }
  });

  test("case and surrounding whitespace never matter", () => {
    assert.equal(canonicalUnitCode("  KGS  "), "kg");
    assert.equal(canonicalUnitCode("\tLitres\n"), "L");
  });

  test("a trailing full stop is tolerated, as receipts abbreviate", () => {
    assert.equal(canonicalUnitCode("kg."), "kg");
    assert.equal(canonicalUnitCode("pcs."), "ea");
  });

  test("returns null rather than inventing a unit", () => {
    // The caller falls back to the item's canonical unit on null. Returning
    // a guess here is what used to create uncomparable one-off units.
    for (const raw of ["dozen", "packs", "bunch", "punnet", "", "   ", "???"]) {
      assert.equal(canonicalUnitCode(raw), null, `${raw} should not resolve`);
    }
  });

  test("null and undefined are handled, not thrown on", () => {
    assert.equal(canonicalUnitCode(null), null);
    assert.equal(canonicalUnitCode(undefined), null);
  });

  test("mass and volume never collide — 'l' is litres, not pounds", () => {
    assert.notEqual(canonicalUnitCode("l"), "kg");
    assert.equal(canonicalUnitCode("l"), "L");
  });
});

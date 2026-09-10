import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { describePack, packTitle, unitName, formatUnitCost } from "./pack-description.ts";

/**
 * The words a pack is shown in. These are read by whoever is submitting a
 * receipt, often for the first time, so the tests pin the exact phrasing.
 */
describe("describePack", () => {
  test("a single item", () => {
    assert.equal(describePack({ innerQuantity: 1, unitLabel: "ea", packCount: 1 }), "Single item");
  });

  test("a pack of items reads as a pack, whichever field holds the count", () => {
    assert.equal(describePack({ innerQuantity: 1, unitLabel: "ea", packCount: 2 }), "Pack of 2");
    assert.equal(describePack({ innerQuantity: 30, unitLabel: "ea", packCount: 1 }), "Pack of 30");
  });

  test("packs of packs give the total", () => {
    assert.equal(
      describePack({ innerQuantity: 30, unitLabel: "ea", packCount: 10 }),
      "10 packs of 30, 300 items"
    );
  });

  test("a weight on its own", () => {
    assert.equal(describePack({ innerQuantity: 5, unitLabel: "kg", packCount: 1 }), "5 kg");
  });

  test("several of a weight give the total", () => {
    assert.equal(
      describePack({ innerQuantity: 5, unitLabel: "kg", packCount: 4 }),
      "4 × 5 kg, 20 kg in total"
    );
    assert.equal(
      describePack({ innerQuantity: 1, unitLabel: "L", packCount: 10 }),
      "10 × 1 L, 10 L in total"
    );
  });

  test("bought loose", () => {
    assert.equal(
      describePack({ innerQuantity: 1, unitLabel: "kg", packCount: 1, soldLoose: true }),
      "Loose, priced per kg"
    );
    assert.equal(
      describePack({ innerQuantity: 1, unitLabel: "ea", packCount: 1, soldLoose: true }),
      "Loose, priced per item"
    );
  });

  test("loose only applies to one unit — a stated pack is still a pack", () => {
    assert.equal(
      describePack({ innerQuantity: 5, unitLabel: "kg", packCount: 1, soldLoose: true }),
      "5 kg"
    );
  });

  test("numeric strings from the database, and no trailing zeros", () => {
    assert.equal(describePack({ innerQuantity: "2.500", unitLabel: "kg", packCount: "2" }), "2 × 2.5 kg, 5 kg in total");
  });

  test("cartons pluralise", () => {
    assert.equal(describePack({ innerQuantity: 2, unitLabel: "Carton", packCount: 1 }), "2 cartons");
    assert.equal(describePack({ innerQuantity: 1, unitLabel: "Carton", packCount: 1 }), "1 carton");
  });
});

describe("packTitle", () => {
  test("a named pack keeps its shape alongside", () => {
    assert.equal(
      packTitle("2 - pack", { innerQuantity: 1, unitLabel: "ea", packCount: 2 }),
      "2 - pack (Pack of 2)"
    );
  });

  test("no name is just the shape", () => {
    assert.equal(packTitle(null, { innerQuantity: 5, unitLabel: "kg", packCount: 1 }), "5 kg");
    assert.equal(packTitle("  ", { innerQuantity: 5, unitLabel: "kg", packCount: 1 }), "5 kg");
  });

  test("a name that restates the shape is not repeated", () => {
    assert.equal(packTitle("pack of 2", { innerQuantity: 1, unitLabel: "ea", packCount: 2 }), "pack of 2");
  });
});

describe("unitName", () => {
  test("ea and its spellings are items", () => {
    assert.equal(unitName("ea"), "item");
    assert.equal(unitName("ea", 3), "items");
    assert.equal(unitName("each"), "item");
  });

  test("weights and volumes keep their symbol", () => {
    assert.equal(unitName("kg", 20), "kg");
    assert.equal(unitName("mL"), "mL");
  });
});

describe("formatUnitCost", () => {
  test("items cost each, measures cost per unit", () => {
    assert.equal(formatUnitCost(0.25, "ea"), "$0.2500 each");
    assert.equal(formatUnitCost(2.4, "kg"), "$2.4000/kg");
  });

  test("without the currency sign", () => {
    assert.equal(formatUnitCost(2.4, "kg", { currency: false }), "2.4000/kg");
  });
});

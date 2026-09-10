import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  describePack,
  formatPackPrice,
  formatUnitCost,
  packTitle,
  packagingFromText,
  priceFieldLabel,
  soldAsOf,
  unitName,
} from "./pack-description.ts";

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

describe("describePack with packaging", () => {
  test("a box of a set weight", () => {
    assert.equal(
      describePack({ innerQuantity: 6, unitLabel: "kg", packCount: 1, packaging: "box" }),
      "Box of 6 kg"
    );
  });

  test("a carton of smaller packs gives the total", () => {
    assert.equal(
      describePack({ innerQuantity: 1, unitLabel: "L", packCount: 10, packaging: "carton" }),
      "Carton of 10 × 1 L, 10 L in total"
    );
  });

  test("items in packaging", () => {
    assert.equal(describePack({ innerQuantity: 30, unitLabel: "ea", packCount: 1, packaging: "tray" }), "Tray of 30");
    assert.equal(describePack({ innerQuantity: 1, unitLabel: "ea", packCount: 2, packaging: "pack" }), "Pack of 2");
    assert.equal(describePack({ innerQuantity: 1, unitLabel: "ea", packCount: 1, packaging: "bottle" }), "1 bottle");
    assert.equal(
      describePack({ innerQuantity: 30, unitLabel: "ea", packCount: 10, packaging: "carton" }),
      "Carton of 10 × 30, 300 items"
    );
  });

  test("loose wins over packaging", () => {
    assert.equal(
      describePack({ innerQuantity: 1, unitLabel: "kg", packCount: 1, soldLoose: true, packaging: "box" }),
      "Loose, priced per kg"
    );
  });

  test("a word the database would refuse is ignored rather than shown", () => {
    assert.equal(describePack({ innerQuantity: 5, unitLabel: "kg", packCount: 1, packaging: "crate" }), "5 kg");
  });
});

describe("packTitle", () => {
  test("a name that says no more than the shape is not shown", () => {
    assert.equal(
      packTitle("6 kg box", { innerQuantity: 6, unitLabel: "kg", packCount: 1, packaging: "box" }),
      "Box of 6 kg"
    );
    assert.equal(packTitle("2 - pack", { innerQuantity: 1, unitLabel: "ea", packCount: 2 }), "Pack of 2");
    assert.equal(
      packTitle("Cartons", { innerQuantity: 1, unitLabel: "L", packCount: 10, packaging: "carton" }),
      "Carton of 10 × 1 L, 10 L in total"
    );
  });

  test("a shape that says no more than the name is not repeated after it", () => {
    assert.equal(packTitle("6 kg box", { innerQuantity: 6, unitLabel: "kg", packCount: 1 }), "6 kg box");
  });

  test("a name that adds something keeps the shape alongside", () => {
    assert.equal(
      packTitle("Large box", { innerQuantity: 6, unitLabel: "kg", packCount: 1, packaging: "box" }),
      "Large box (Box of 6 kg)"
    );
  });

  test("no name is just the shape", () => {
    assert.equal(packTitle(null, { innerQuantity: 5, unitLabel: "kg", packCount: 1 }), "5 kg");
    assert.equal(packTitle("  ", { innerQuantity: 5, unitLabel: "kg", packCount: 1 }), "5 kg");
  });
});

describe("packagingFromText", () => {
  test("reads the packaging a line names", () => {
    assert.equal(packagingFromText("Green Chilli 6kg Box"), "box");
    assert.equal(packagingFromText("Potatoes 20kg SACK"), "sack");
    assert.equal(packagingFromText("Coconut milk 400ml can"), "tin");
  });

  test("outer packaging wins", () => {
    assert.equal(packagingFromText("Milk 1L x 10 bottles CTN"), "carton");
    assert.equal(packagingFromText("carton of 10 bottles"), "carton");
  });

  test("only whole words", () => {
    assert.equal(packagingFromText("Tinned tomatoes"), null);
    assert.equal(packagingFromText("Boxer shorts"), null);
  });

  test("nothing to read", () => {
    assert.equal(packagingFromText(""), null);
    assert.equal(packagingFromText(null), null);
    assert.equal(packagingFromText("Green Chilli"), null);
  });
});

describe("soldAsOf", () => {
  test("reads a stored pack back into the form's choice", () => {
    assert.equal(soldAsOf({ innerQuantity: 1, unitLabel: "kg", packCount: 1, soldLoose: true }), "loose");
    assert.equal(soldAsOf({ innerQuantity: 6, unitLabel: "kg", packCount: 1, packaging: "box" }), "box");
    assert.equal(soldAsOf({ innerQuantity: 6, unitLabel: "kg", packCount: 1 }), "");
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

describe("formatPackPrice", () => {
  test("a pack's price names what it is a price for", () => {
    assert.equal(
      formatPackPrice(40, { innerQuantity: 6, unitLabel: "kg", packCount: 1, packaging: "box" }),
      "$40.00 per box"
    );
    assert.equal(formatPackPrice(40, { innerQuantity: 6, unitLabel: "kg", packCount: 1 }), "$40.00 per pack");
  });

  test("a loose price is already per unit", () => {
    assert.equal(
      formatPackPrice(7, { innerQuantity: 1, unitLabel: "kg", packCount: 1, soldLoose: true }),
      "$7.00/kg"
    );
    assert.equal(
      formatPackPrice(0.5, { innerQuantity: 1, unitLabel: "ea", packCount: 1, soldLoose: true }),
      "$0.50 each"
    );
  });
});

describe("priceFieldLabel", () => {
  test("asks for the price of the thing actually bought", () => {
    assert.equal(priceFieldLabel({ innerQuantity: 6, unitLabel: "kg", packCount: 1, packaging: "box" }), "Price per box");
    assert.equal(priceFieldLabel({ innerQuantity: 1, unitLabel: "kg", packCount: 1, soldLoose: true }), "Price per kg");
    assert.equal(priceFieldLabel({ innerQuantity: 6, unitLabel: "kg", packCount: 1 }), "Price per pack");
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveSection, sectionFor } from "./menu-sections";

describe("sectionFor (#70)", () => {
  test("meat, however the category is written", () => {
    assert.equal(sectionFor(["Meat & Poultry", "Lamb"]), "meat");
    assert.equal(sectionFor(["Meat & Poultry", "Chicken"]), "meat");
    assert.equal(sectionFor(["Mutton"]), "meat");
    assert.equal(sectionFor(["Fish & Seafood"]), "meat");
  });

  test("fresh produce", () => {
    assert.equal(sectionFor(["Produce (Fruit & Vegetables)"]), "produce");
    assert.equal(sectionFor(["Produce (Fruit & Vegetables)", "Herbs"]), "produce");
  });

  test("everything else is dry goods, which is the list that will want editing", () => {
    assert.equal(sectionFor(["Groceries"]), "dry");
    assert.equal(sectionFor(["Daals/Lentils"]), "dry");
    assert.equal(sectionFor(["Dairy & Eggs"]), "dry");
    assert.equal(sectionFor(["Disposables & Packaging"]), "dry");
    assert.equal(sectionFor([null, undefined]), "dry", "an uncategorised item still lands somewhere");
  });

  test("the parent decides when the leaf says nothing", () => {
    assert.equal(sectionFor(["Meat & Poultry", "Legs and Shoulders"]), "meat");
  });
});

describe("roti is its own list (#76)", () => {
  test("bread does not go in with the rice and the oil", () => {
    assert.equal(sectionFor(["Bakery", "Roti"]), "roti");
    assert.equal(sectionFor(["Bread"]), "roti");
  });

  test("a category set to roti by hand is roti", () => {
    assert.equal(resolveSection({ categorySection: "roti", categoryName: "Groceries" }), "roti");
  });

  test("an item on the roti list stays there whatever its category says", () => {
    assert.equal(resolveSection({ itemSection: "roti", categoryName: "Meat & Poultry" }), "roti");
  });
});

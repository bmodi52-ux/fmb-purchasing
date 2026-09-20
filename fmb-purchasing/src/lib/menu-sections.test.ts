import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sectionFor } from "./menu-sections";

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

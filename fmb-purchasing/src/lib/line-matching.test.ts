import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  choosePack,
  coreWords,
  matchLine,
  type CatalogueItem,
  type CataloguePack,
  type CatalogueUnit,
  type KnownWording,
} from "./line-matching.ts";

/**
 * Reading receipt lines onto Pricelist items that already exist.
 *
 * The fixture is a real handwritten BLF + Mix invoice whose eleven lines all
 * failed to find items set up by hand beforehand — Mushrooms, Tomato, Potatoes
 * — because the invoice said "Mushroom Boxes", "Box Tomato", "15kg Wash
 * Potatoes". Every one of those lines is pinned here.
 */

const units: CatalogueUnit[] = [
  { code: "kg", baseUnitCode: "kg", toBaseFactor: 1 },
  { code: "g", baseUnitCode: "kg", toBaseFactor: 0.001 },
  { code: "ea", baseUnitCode: "ea", toBaseFactor: 1 },
];

const pack = (id: string, overrides: Partial<CataloguePack> = {}): CataloguePack => ({
  id,
  label: null,
  innerQuantity: 1,
  unitCode: "kg",
  packCount: 1,
  soldLoose: false,
  packaging: null,
  ...overrides,
});

const item = (id: string, name: string, packs: CataloguePack[] = [], categoryName = "Produce"): CatalogueItem => ({
  id,
  name,
  itemNumber: null,
  categoryName,
  packs,
});

const produce: CatalogueItem[] = [
  item("mushrooms", "Mushrooms", [pack("mushrooms-box", { packaging: "box", innerQuantity: 3 })]),
  item("green-chilli", "Green Chilli", [
    pack("chilli-box", { packaging: "box", innerQuantity: 6 }),
    pack("chilli-loose", { soldLoose: true }),
  ]),
  item("coriander", "Coriander", [pack("coriander-bunch", { packaging: "bunch", unitCode: "ea" })]),
  item("tomato", "Tomato", [
    pack("tomato-box", { label: "Jumbo Box", packaging: "box", innerQuantity: 10 }),
    pack("tomato-loose", { soldLoose: true }),
  ]),
  item("cherry-tomato", "Cherry Tomato", [pack("cherry-punnet", { packaging: "punnet", innerQuantity: 0.25 })]),
  item("onions", "Onions", [
    pack("onions-20", { packaging: "bag", innerQuantity: 20 }),
    pack("onions-10", { packaging: "bag", innerQuantity: 10 }),
  ]),
  item("potatoes", "Potatoes", [pack("potatoes-15", { packaging: "sack", innerQuantity: 15 })]),
  item("sweet-potato", "Sweet Potato", [pack("sweet-potato-loose", { soldLoose: true })]),
  item("ginger", "Ginger", [pack("ginger-loose", { soldLoose: true })]),
];

const packsOf = (id: string) => produce.find((i) => i.id === id)!.packs;
const none = new Set<string>();

describe("coreWords", () => {
  test("keeps what the product is and sets aside how it was bought", () => {
    assert.deepEqual(coreWords("15kg Wash Potatoes"), ["wash", "potato"]);
    assert.deepEqual(coreWords("Coriander Bunches"), ["coriander"]);
    assert.deepEqual(coreWords("Mushroom Boxes"), ["mushroom"]);
    assert.deepEqual(coreWords("2 x 20kg ONIONS"), ["onion"]);
  });

  test("plurals share a form with the singular", () => {
    assert.deepEqual(coreWords("Tomatoes"), coreWords("Tomato"));
    assert.deepEqual(coreWords("Chillies"), coreWords("Chilli"));
    assert.deepEqual(coreWords("Berries"), coreWords("Berry"));
  });
});

describe("matchLine on the BLF + Mix invoice", () => {
  const expectations: [string, string, "sure" | "likely"][] = [
    ["Mushroom Boxes", "mushrooms", "sure"],
    ["Green Chilli", "green-chilli", "sure"],
    ["Coriander", "coriander", "sure"],
    ["Tomatoes", "tomato", "sure"],
    ["20kg Onions", "onions", "sure"],
    // An extra word on the line is worth a glance: "Sweet Potato" would read
    // the same way against an item called Potatoes.
    ["15kg Wash Potatoes", "potatoes", "likely"],
    ["Jumbo Ginger", "ginger", "likely"],
    ["Chilli Box", "green-chilli", "likely"],
    ["Coriander Bunches", "coriander", "sure"],
    ["Box Tomato", "tomato", "sure"],
  ];

  for (const [description, itemId, confidence] of expectations) {
    test(`"${description}" is ${itemId}`, () => {
      const pick = matchLine({ description }, produce, [], "blf");
      assert.equal(pick.itemId, itemId);
      assert.equal(pick.confidence, confidence);
    });
  }
});

describe("matchLine", () => {
  test("a wording this vendor has used before is certain", () => {
    const wordings: KnownWording[] = [{ itemId: "green-chilli", vendorId: "blf", description: "CHILLI BOX" }];
    assert.deepEqual(matchLine({ description: "Chilli box" }, produce, wordings, "blf"), {
      confidence: "sure",
      itemId: "green-chilli",
      alternatives: [],
    });
  });

  test("so is another vendor's, when only one item has it", () => {
    const wordings: KnownWording[] = [{ itemId: "tomato", vendorId: "someone-else", description: "Roma Tom" }];
    assert.equal(matchLine({ description: "roma tom" }, produce, wordings, "blf").itemId, "tomato");
  });

  test("a wording for an item no longer offered is ignored", () => {
    const wordings: KnownWording[] = [{ itemId: "rejected-item", vendorId: "blf", description: "Tomatoes" }];
    assert.equal(matchLine({ description: "Tomatoes" }, produce, wordings, "blf").itemId, "tomato");
  });

  test("the exact item beats a less specific one", () => {
    const catalogue = [item("thigh", "Chicken Thigh"), item("fillet", "Chicken Thigh Fillet")];
    const pick = matchLine({ description: "Chicken Thigh Fillets" }, catalogue, [], null);
    assert.equal(pick.itemId, "fillet");
    assert.equal(pick.confidence, "sure");
  });

  test("the plain item beats a variety of it", () => {
    const pick = matchLine({ description: "Tomatoes" }, produce, [], null);
    assert.equal(pick.itemId, "tomato");
    assert.ok(pick.alternatives.includes("cherry-tomato"));
  });

  test("a handwriting slip still finds the item, but asks", () => {
    assert.deepEqual(
      [matchLine({ description: "Corriander" }, produce, [], null)].map((p) => [p.itemId, p.confidence]),
      [["coriander", "likely"]]
    );
    assert.equal(matchLine({ description: "Tomatoe" }, produce, [], null).itemId, "tomato");
  });

  test("two equally good items are offered, not chosen between", () => {
    const catalogue = [...produce, item("red-chilli", "Red Chilli")];
    const pick = matchLine({ description: "Chilli Box" }, catalogue, [], null);
    assert.equal(pick.confidence, "none");
    assert.equal(pick.itemId, null);
    assert.deepEqual(pick.alternatives, ["green-chilli", "red-chilli"]);
  });

  test("a tie is broken by the category extraction read, and flagged", () => {
    const catalogue = [item("beef-mince", "Mince", [], "Beef"), item("lamb-mince", "Mince", [], "Lamb")];
    const pick = matchLine({ description: "Mince", categoryName: "Lamb" }, catalogue, [], null);
    assert.equal(pick.itemId, "lamb-mince");
    assert.equal(pick.confidence, "likely");
    assert.equal(matchLine({ description: "Mince" }, catalogue, [], null).itemId, null);
  });

  test("short words must match exactly", () => {
    const catalogue = [item("beef", "Beef")];
    assert.equal(matchLine({ description: "Beet" }, catalogue, [], null).itemId, null);
  });

  test("nothing in common is no match", () => {
    assert.deepEqual(matchLine({ description: "Delivery fee" }, produce, [], null), {
      confidence: "none",
      itemId: null,
      alternatives: [],
    });
  });
});

describe("choosePack", () => {
  test("an item with one pack is that pack", () => {
    assert.equal(choosePack(packsOf("mushrooms"), "Mushroom Boxes", units, none), "mushrooms-box");
  });

  test("the packaging the line names", () => {
    assert.equal(choosePack(packsOf("tomato"), "Box Tomato", units, none), "tomato-box");
  });

  test("the weight the line states", () => {
    assert.equal(choosePack(packsOf("onions"), "20kg Onions", units, none), "onions-20");
  });

  test("a stated weight in another unit of the same measure", () => {
    const packs = [pack("half", { innerQuantity: 0.5 }), pack("one", { innerQuantity: 1 })];
    assert.equal(choosePack(packs, "Ginger 500g", units, none), "half");
  });

  test("loose, when the line says so", () => {
    assert.equal(choosePack(packsOf("green-chilli"), "Green Chilli loose", units, none), "chilli-loose");
  });

  test("the pack this vendor already sells, when the line says nothing", () => {
    assert.equal(choosePack(packsOf("green-chilli"), "Green Chilli", units, new Set(["chilli-box"])), "chilli-box");
  });

  test("two boxes of the same weight are told apart only by a grade the line names", () => {
    // Tomato on the live Pricelist: a Jumbo Box and a Standard box, both 10 kg.
    const packs = [
      pack("jumbo", { label: "Jumbo Box", packaging: "box", innerQuantity: 10 }),
      pack("standard", { label: "Standard box", packaging: "box", innerQuantity: 10 }),
    ];
    assert.equal(choosePack(packs, "Box Tomato", units, none, "Tomato"), null);
    assert.equal(choosePack(packs, "Jumbo Tomato Box", units, none, "Tomato"), "jumbo");
    assert.equal(choosePack(packs, "Standard Tomatoes", units, none, "Tomato"), "standard");
  });

  test("the item's own name in a pack's name is not evidence for that pack", () => {
    const packs = [
      pack("washed", { label: "Washed Potatoes", packaging: "sack", innerQuantity: 15 }),
      pack("loose", { label: "Potatoes loose", soldLoose: true }),
    ];
    assert.equal(choosePack(packs, "Potatoes", units, none, "Potatoes"), null);
  });

  test("nothing to go on is left for the person to choose", () => {
    assert.equal(choosePack(packsOf("tomato"), "Tomatoes", units, none), null);
  });

  test("no packs at all", () => {
    assert.equal(choosePack([], "Tomatoes", units, none), null);
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  batchesFor,
  portionLabel,
  costMenuDay,
  priceFor,
  requirementsFor,
  boxesFilled,
  type MenuDish,
} from "./menu-costing";

const kg = { unitCode: "kg", unitToBase: 1, baseUnitCode: "kg" };
const g = { unitCode: "g", unitToBase: 0.001, baseUnitCode: "kg" };

/** Taken from the sheet this replaces: 18 Sep, Bhuna gosht and Mug pulao. */
const bhunaGosht: MenuDish = {
  dishId: "d-bhuna",
  dishName: "Bhuna gosht",
  basis: "batch",
  portionMl: 1000,
  batchBoxes: 200,
  ingredients: [
    { itemId: "i-goat", itemName: "Goat", quantity: 120, ...kg },
    { itemId: "i-onion", itemName: "Onions", quantity: 80, ...kg },
    { itemId: "i-ginger", itemName: "Ginger", quantity: 5, ...kg },
  ],
};

const mugPulao: MenuDish = {
  dishId: "d-pulao",
  dishName: "Mug pulao",
  basis: "batch",
  portionMl: 1000,
  batchBoxes: 200,
  ingredients: [
    { itemId: "i-mug", itemName: "Mug green whole daal", quantity: 15, ...kg },
    { itemId: "i-onion", itemName: "Onions", quantity: 20, ...kg },
  ],
};

const kadhi: MenuDish = {
  dishId: "d-kadhi",
  dishName: "Kadhi",
  basis: "box",
  portionMl: 650,
  batchBoxes: null,
  ingredients: [{ itemId: "i-yoghurt", itemName: "Yoghurt", quantity: 400, ...g }],
};

describe("batchesFor", () => {
  test("a batch recipe cannot be made in fractions", () => {
    assert.equal(batchesFor(bhunaGosht, 200), 1);
    assert.equal(batchesFor(bhunaGosht, 201), 2, "one thaali over is another pot");
    assert.equal(batchesFor(bhunaGosht, 400), 2);
  });

  test("a per-box recipe scales exactly", () => {
    assert.equal(batchesFor(kadhi, 250), 250);
  });

  test("no thaalis, nothing to cook", () => {
    assert.equal(batchesFor(bhunaGosht, 0), 0);
    assert.equal(batchesFor({ basis: "batch", batchBoxes: null }, 100), 0, "a batch recipe with no size");
  });

  test("what a rounded-up batch actually fills", () => {
    assert.equal(boxesFilled(bhunaGosht, 250), 400, "two batches of 200 boxes");
    assert.equal(boxesFilled(kadhi, 250), 250);
  });
});

describe("requirementsFor", () => {
  test("the same item from two dishes is one line", () => {
    const lines = requirementsFor([bhunaGosht, mugPulao], 200);
    const onions = lines.find((l) => l.itemId === "i-onion");
    assert.equal(onions?.quantity, 100, "80 from the gosht, 20 from the pulao");
    assert.deepEqual(onions?.fromDishes, ["Bhuna gosht", "Mug pulao"]);
    assert.equal(lines.length, 4);
  });

  test("recipes written in grams come back in the base unit", () => {
    const [yoghurt] = requirementsFor([kadhi], 250);
    assert.equal(yoghurt.quantity, 100, "400 g a box × 250 boxes");
    assert.equal(yoghurt.baseUnitCode, "kg");
  });

  test("a second batch doubles what it takes", () => {
    const lines = requirementsFor([bhunaGosht], 201);
    assert.equal(lines.find((l) => l.itemId === "i-goat")?.quantity, 240);
  });

  test("lines read in name order, and nothing is needed for no thaalis", () => {
    assert.deepEqual(
      requirementsFor([bhunaGosht], 200).map((l) => l.itemName),
      ["Ginger", "Goat", "Onions"]
    );
    assert.deepEqual(requirementsFor([bhunaGosht], 0), []);
  });
});

describe("priceFor", () => {
  test("what was paid beats what was quoted", () => {
    assert.deepEqual(priceFor({ latestPaid: 12, cheapestRecent: 10, offer: 9 }), {
      perUnit: 12,
      basis: "paid_latest",
    });
    assert.deepEqual(priceFor({ cheapestRecent: 10, offer: 9 }), { perUnit: 10, basis: "paid_cheapest_recent" });
    assert.deepEqual(priceFor({ offer: 9 }), { perUnit: 9, basis: "offer" });
  });

  test("nothing to go on says so rather than guessing zero", () => {
    assert.deepEqual(priceFor(undefined), { perUnit: null, basis: "none" });
    assert.deepEqual(priceFor({ latestPaid: 0, cheapestRecent: null }), { perUnit: null, basis: "none" });
  });
});

describe("costMenuDay", () => {
  const prices = new Map([
    ["i-goat", { latestPaid: 14 }],
    ["i-onion", { cheapestRecent: 1.5 }],
    ["i-ginger", { offer: 8 }],
  ]);

  test("the cost of a day, and of one thaali", () => {
    const cost = costMenuDay([bhunaGosht], 200, prices);
    // 120 kg goat at 14, 80 kg onions at 1.50, 5 kg ginger at 8.
    assert.equal(cost.total, 1680 + 120 + 40);
    assert.equal(cost.perThaali, 9.2);
    assert.equal(cost.unpriced, 0);
    assert.deepEqual(
      cost.lines.map((l) => l.basis),
      ["offer", "paid_latest", "paid_cheapest_recent"]
    );
  });

  test("an item with no price is counted as unpriced, not as free", () => {
    const cost = costMenuDay([bhunaGosht, kadhi], 200, prices);
    assert.equal(cost.unpriced, 1);
    assert.equal(cost.lines.find((l) => l.itemId === "i-yoghurt")?.cost, null);
  });

  test("the cost of rounding a batch up lands on the thaalis being served", () => {
    const cost = costMenuDay([bhunaGosht], 201, prices);
    assert.equal(cost.total, 3680, "two batches");
    assert.equal(cost.perThaali, 18.31, "not halved because the second pot filled 200 more boxes");
  });

  test("no thaalis, no cost per thaali", () => {
    assert.equal(costMenuDay([bhunaGosht], 0, prices).perThaali, null);
  });
});

describe("portionLabel", () => {
  test("boxes read as the kitchen says them", () => {
    assert.equal(portionLabel(1000), "1 L box");
    assert.equal(portionLabel(650), "650 ml box");
    assert.equal(portionLabel(100), "100 ml box");
  });
});

describe("two dishes in different boxes on the same day", () => {
  // 250 thaalis: bhuna gosht from a 200-box batch, kadhi portioned per box.
  test("each dish scales in its own boxes", () => {
    assert.equal(batchesFor(bhunaGosht, 250), 2, "1 L boxes, from a batch of 200");
    assert.equal(batchesFor(kadhi, 250), 250, "650 ml boxes, one at a time");
    const lines = requirementsFor([bhunaGosht, kadhi], 250);
    assert.equal(lines.find((l) => l.itemId === "i-goat")?.quantity, 240, "two batches");
    assert.equal(lines.find((l) => l.itemId === "i-yoghurt")?.quantity, 100, "400 g × 250 boxes");
  });
});

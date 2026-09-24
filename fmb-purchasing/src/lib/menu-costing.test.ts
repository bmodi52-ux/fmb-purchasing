import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  batchesFor,
  boxesFor,
  boxSizeOptions,
  countFor,
  portionLabel,
  costMenuDay,
  pickCheapest,
  priceFor,
  priceFromLabel,
  requirementsFor,
  type PriceCandidate,
  type MenuDish,
  type MenuExtra,
  type MenuLine,
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
  test("a batch recipe scales to what is needed, fractions and all", () => {
    assert.equal(batchesFor(bhunaGosht, 200), 1);
    assert.equal(batchesFor(bhunaGosht, 250), 1.25, "the kitchen scales the recipe down, not up to two pots");
    assert.equal(batchesFor(bhunaGosht, 400), 2);
  });

  test("a per-box recipe scales exactly", () => {
    assert.equal(batchesFor(kadhi, 250), 250);
  });

  test("no thaalis, nothing to cook", () => {
    assert.equal(batchesFor(bhunaGosht, 0), 0);
    assert.equal(batchesFor({ basis: "batch", batchBoxes: null }, 100), 0, "a batch recipe with no size");
  });


});

describe("requirementsFor", () => {
  test("the same item from two dishes is one line", () => {
    const lines = requirementsFor({ dishes: [bhunaGosht, mugPulao] }, 200);
    const onions = lines.find((l) => l.itemId === "i-onion");
    assert.equal(onions?.quantity, 100, "80 from the gosht, 20 from the pulao");
    assert.deepEqual(onions?.fromDishes, ["Bhuna gosht", "Mug pulao"]);
    assert.equal(lines.length, 4);
  });

  test("recipes written in grams come back in the base unit", () => {
    const [yoghurt] = requirementsFor({ dishes: [kadhi] }, 250);
    assert.equal(yoghurt.quantity, 100, "400 g a box × 250 boxes");
    assert.equal(yoghurt.baseUnitCode, "kg");
  });

  test("a quarter more thaalis is a quarter more of everything", () => {
    const lines = requirementsFor({ dishes: [bhunaGosht] }, 250);
    assert.equal(lines.find((l) => l.itemId === "i-goat")?.quantity, 150, "120 kg × 1.25");
    assert.equal(lines.find((l) => l.itemId === "i-onion")?.quantity, 100);
  });

  test("lines read in name order, and nothing is needed for no thaalis", () => {
    assert.deepEqual(
      requirementsFor({ dishes: [bhunaGosht] }, 200).map((l) => l.itemName),
      ["Ginger", "Goat", "Onions"]
    );
    assert.deepEqual(requirementsFor({ dishes: [bhunaGosht] }, 0), []);
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
    const cost = costMenuDay({ dishes: [bhunaGosht] }, 200, prices);
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
    const cost = costMenuDay({ dishes: [bhunaGosht, kadhi] }, 200, prices);
    assert.equal(cost.unpriced, 1);
    assert.equal(cost.lines.find((l) => l.itemId === "i-yoghurt")?.cost, null);
  });

  test("cost per thaali holds steady as the count moves, because nothing is rounded", () => {
    const at200 = costMenuDay({ dishes: [bhunaGosht] }, 200, prices);
    const at250 = costMenuDay({ dishes: [bhunaGosht] }, 250, prices);
    assert.equal(at250.total, 2300, "1.25 × 1,840");
    assert.equal(at250.perThaali, at200.perThaali);
  });

  test("no thaalis, no cost per thaali", () => {
    assert.equal(costMenuDay({ dishes: [bhunaGosht] }, 0, prices).perThaali, null);
  });
});

describe("boxSizeOptions", () => {
  test("largest box first, however the list came out of the table", () => {
    assert.deepEqual(boxSizeOptions([650, 1000]), [1000, 650]);
  });

  test("the size a dish already uses is offered even once it is off the list", () => {
    assert.deepEqual(boxSizeOptions([1000, 650], 400), [1000, 650, 400]);
  });

  test("no duplicate when the dish uses a size still on the list", () => {
    assert.deepEqual(boxSizeOptions([1000, 650], 650), [1000, 650]);
  });

  test("an empty list still offers a litre, so a dish can always be written", () => {
    assert.deepEqual(boxSizeOptions([]), [1000]);
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
    assert.equal(batchesFor(bhunaGosht, 250), 1.25, "1 L boxes, from a batch of 200");
    assert.equal(batchesFor(kadhi, 250), 250, "650 ml boxes, one at a time");
    const lines = requirementsFor({ dishes: [bhunaGosht, kadhi] }, 250);
    assert.equal(lines.find((l) => l.itemId === "i-goat")?.quantity, 150, "1.25 batches");
    assert.equal(lines.find((l) => l.itemId === "i-yoghurt")?.quantity, 100, "400 g × 250 boxes");
  });
});

describe("a thaali is a set of boxes, and not everybody takes all of it (#76)", () => {
  // Menu B from the sheet: gosht, daal and rice, each one box, taken
  // separately. 250 thaalis, but only 180 want the gosht.
  const gosht: MenuDish = {
    dishId: "d-gosht",
    dishName: "Gosht",
    basis: "box",
    portionMl: 650,
    batchBoxes: null,
    ingredients: [
      { itemId: "i-goat", itemName: "Goat", quantity: 0.5, unitCode: "kg", unitToBase: 1, baseUnitCode: "kg" },
    ],
  };

  test("a line with nobody counted assumes everyone takes everything it offers", () => {
    assert.equal(boxesFor({}, 250), 250, "one box each");
    assert.equal(boxesFor({ boxesOffered: 2 }, 250), 500, "two boxes offered, so two boxes each");
  });

  test("a count against the line is what gets cooked", () => {
    assert.equal(boxesFor({ boxesOffered: 2, expectedBoxes: 380 }, 250), 380);
  });

  test("nobody taking it is nothing to cook, not the day's count", () => {
    assert.equal(boxesFor({ expectedBoxes: 0 }, 250), 0);
  });

  test("quantities follow the line's own count, not the day's", () => {
    const [line] = requirementsFor({ dishes: [{ ...gosht, expectedBoxes: 180 }] }, 250);
    assert.equal(line.quantity, 90, "180 boxes × 500 g");
  });

  test("a dish nobody takes is bought for nobody", () => {
    assert.deepEqual(requirementsFor({ dishes: [{ ...gosht, expectedBoxes: 0 }] }, 250), []);
  });

  test("biryani offered as two boxes is cooked for the boxes, not the people", () => {
    const biryani: MenuDish = {
      dishId: "d-biryani",
      dishName: "Chicken biryani",
      basis: "batch",
      portionMl: 1000,
      batchBoxes: 200,
      boxesOffered: 2,
      expectedBoxes: 380,
      ingredients: [
        { itemId: "i-rice", itemName: "Rice", quantity: 40, unitCode: "kg", unitToBase: 1, baseUnitCode: "kg" },
      ],
    };
    assert.equal(batchesFor(biryani, boxesFor(biryani, 250)), 1.9, "380 boxes from a batch of 200");
    assert.equal(requirementsFor({ dishes: [biryani] }, 250)[0].quantity, 76, "1.9 × 40 kg");
  });
});

describe("the parts of a thaali that are not dishes (#76)", () => {
  const roti: MenuExtra = {
    extraId: "x-roti",
    kind: "roti",
    itemId: "i-roti",
    itemName: "Roti",
    perThaali: 1,
    unitCode: "ea",
    unitToBase: 1,
    baseUnitCode: "ea",
  };

  test("how many to buy is how much each, times how many take it", () => {
    const [line] = requirementsFor({ extras: [{ ...roti, expectedCount: 120 }] }, 250);
    assert.equal(line.quantity, 120);
    assert.equal(line.itemName, "Roti");
  });

  test("half a roti each is half a roti for everyone who takes one", () => {
    const [line] = requirementsFor({ extras: [{ ...roti, perThaali: 0.5, expectedCount: 120 }] }, 250);
    assert.equal(line.quantity, 60);
  });

  test("nobody counted means the day's count", () => {
    assert.equal(countFor({}, 250), 250);
    assert.equal(requirementsFor({ extras: [roti] }, 250)[0].quantity, 250);
  });

  test("an extra and a dish that want the same item are one line to buy", () => {
    const fruitDish: MenuDish = {
      dishId: "d-salad",
      dishName: "Fruit salad",
      basis: "box",
      portionMl: 250,
      batchBoxes: null,
      ingredients: [
        { itemId: "i-apple", itemName: "Apples", quantity: 0.2, unitCode: "kg", unitToBase: 1, baseUnitCode: "kg" },
      ],
    };
    const apples: MenuExtra = {
      extraId: "x-fruit",
      kind: "fruit",
      itemId: "i-apple",
      itemName: "Apples",
      perThaali: 0.15,
      expectedCount: 100,
      unitCode: "kg",
      unitToBase: 1,
      baseUnitCode: "kg",
    };
    const lines = requirementsFor({ dishes: [{ ...fruitDish, expectedBoxes: 50 }], extras: [apples] }, 250);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].quantity, 25, "50 × 200 g, plus 100 × 150 g");
    assert.deepEqual(lines[0].fromDishes, ["Fruit salad", "Apples"]);
  });

  test("cost per thaali is still divided by the thaalis, not by the boxes", () => {
    const prices = new Map([["i-roti", { latestPaid: 2 }]]);
    const cost = costMenuDay({ dishes: [], extras: [{ ...roti, expectedCount: 120 }] }, 250, prices);
    assert.equal(cost.total, 240, "120 roti at $2");
    assert.equal(cost.perThaali, 0.96, "240 ÷ 250, because that is what a thaali costs on average");
  });
});

describe("a day typed the way the sheet types it (#77)", () => {
  const goat: MenuLine = {
    lineId: "l-goat",
    itemId: "i-goat",
    itemName: "Goat",
    quantity: 120,
    unitCode: "kg",
    unitToBase: 1,
    baseUnitCode: "kg",
  };

  test("a typed quantity is what to buy, with nothing to work out", () => {
    const [line] = requirementsFor({ lines: [goat] }, 250);
    assert.equal(line.quantity, 120);
    assert.equal(line.baseUnitCode, "kg");
  });

  test("it does not move when the count does, because nobody said it should", () => {
    assert.equal(requirementsFor({ lines: [goat] }, 250)[0].quantity, 120);
    assert.equal(requirementsFor({ lines: [goat] }, 500)[0].quantity, 120);
  });

  test("typed in the unit it was written in, converted like any other", () => {
    const yoghurt: MenuLine = {
      lineId: "l-yoghurt",
      itemId: "i-yoghurt",
      itemName: "Yoghurt",
      quantity: 800,
      unitCode: "g",
      unitToBase: 0.001,
      baseUnitCode: "kg",
    };
    assert.equal(requirementsFor({ lines: [yoghurt] }, 250)[0].quantity, 0.8);
  });

  test("a typed line costs the same way a worked-out one does", () => {
    const prices = new Map([["i-goat", { latestPaid: 27 }]]);
    const cost = costMenuDay({ lines: [goat] }, 250, prices);
    assert.equal(cost.total, 3240);
    assert.equal(cost.perThaali, 12.96);
  });

  test("a day planned both ways has one line per item to buy", () => {
    const kadhi: MenuDish = {
      dishId: "d-kadhi",
      dishName: "Kadhi",
      basis: "box",
      portionMl: 650,
      batchBoxes: null,
      ingredients: [
        { itemId: "i-goat", itemName: "Goat", quantity: 0.1, unitCode: "kg", unitToBase: 1, baseUnitCode: "kg" },
      ],
    };
    const lines = requirementsFor({ dishes: [kadhi], lines: [goat] }, 100);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].quantity, 130, "120 typed in, plus 100 boxes x 100 g");
    assert.deepEqual(lines[0].fromDishes, ["Kadhi", "typed in"]);
  });

  test("nothing typed and nothing cooked is nothing to buy", () => {
    assert.deepEqual(requirementsFor({}, 250), []);
  });
});

describe("the cheapest price wins (#29)", () => {
  const c = (perUnit: number, source: "paid" | "quoted", vendorName: string, brand: string | null, date = "2026-09-12"): PriceCandidate => ({
    perUnit,
    source,
    vendorName,
    brand,
    date,
  });
  const rice = [
    c(7.4, "paid", "Taj Mart", "India Gate"),
    c(6.6, "quoted", "Costco", "Tilda"),
    c(7.2, "quoted", "Coles", "Taj"),
    c(8.0, "paid", "Woolworths", "Tilda"),
  ];

  test("across every store and brand, paid or quoted, even never bought", () => {
    const best = pickCheapest(rice, null);
    assert.equal(best?.vendorName, "Costco");
    assert.equal(best?.source, "quoted");
    assert.equal(best?.brandMissing, false);
  });

  test("a preferred brand is costed at that brand only, at its cheapest store", () => {
    assert.equal(pickCheapest(rice, "tilda")?.vendorName, "Costco");
    assert.equal(pickCheapest(rice, "India Gate")?.perUnit, 7.4);
  });

  test("no price for the preferred brand yet: the cheapest of any brand, and it says so", () => {
    const best = pickCheapest(rice, "Daawat");
    assert.equal(best?.vendorName, "Costco");
    assert.equal(best?.brandMissing, true);
  });

  test("a tie goes to what was actually paid", () => {
    assert.equal(pickCheapest([c(5, "quoted", "A", null), c(5, "paid", "B", null)], null)?.source, "paid");
  });

  test("nothing priced, nothing picked", () => {
    assert.equal(pickCheapest([c(0, "paid", "A", null)], null), null);
    assert.equal(pickCheapest([], null), null);
  });

  test("costing uses it and says where it is from", () => {
    const cheapest = pickCheapest(rice, null);
    assert.deepEqual(priceFor({ cheapest, latestPaid: 9 }), {
      perUnit: 6.6,
      basis: "cheapest_quoted",
      from: "Tilda at Costco, quoted 12/09",
    });
  });

  test("the label copes with what isn't known", () => {
    assert.equal(priceFromLabel(c(1, "paid", "Taj Mart", null, "2026-08-01")), "Taj Mart, paid 01/08");
    assert.equal(priceFromLabel({ ...c(1, "quoted", "", null), vendorName: null, date: null }), "quoted");
  });
});

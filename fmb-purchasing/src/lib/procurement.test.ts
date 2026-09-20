import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { progressOf, proposeAllocations, suggestPacks, type OpenRequirement } from "./procurement";

const PUREE = [
  { packSizeId: "p-4l", title: "Box of 4 L", totalQuantity: 4 },
  { packSizeId: "p-10l", title: "Drum of 10 L", totalQuantity: 10 },
];

describe("suggestPacks (#70)", () => {
  test("36 litres is nine 4 L boxes, because nobody sells 36 litres", () => {
    assert.deepEqual(suggestPacks(36, PUREE), {
      packSizeId: "p-4l",
      title: "Box of 4 L",
      packs: 9,
      quantity: 36,
      over: 0,
    });
  });

  test("the pack that wastes least wins", () => {
    // 20 L: two drums exactly, against five boxes exactly — a tie, so the
    // larger pack takes it, since fewer to carry.
    assert.equal(suggestPacks(20, PUREE)?.packSizeId, "p-10l");
    // 22 L: three drums wastes 8, six boxes wastes 2.
    assert.deepEqual(
      { id: suggestPacks(22, PUREE)?.packSizeId, over: suggestPacks(22, PUREE)?.over },
      { id: "p-4l", over: 2 }
    );
  });

  test("what the rounding adds is returned, not hidden", () => {
    // 37 L: four drums or ten boxes both come to 40, so the larger pack wins
    // the tie and the 3 L over is stated.
    const suggestion = suggestPacks(37, PUREE);
    assert.deepEqual(
      { id: suggestion?.packSizeId, packs: suggestion?.packs, quantity: suggestion?.quantity, over: suggestion?.over },
      { id: "p-10l", packs: 4, quantity: 40, over: 3 }
    );

    // 15 L: two drums waste 5, four boxes waste 1.
    const boxes = suggestPacks(15, PUREE);
    assert.deepEqual({ id: boxes?.packSizeId, packs: boxes?.packs, over: boxes?.over }, { id: "p-4l", packs: 4, over: 1 });
  });

  test("nothing to suggest without packs or a requirement", () => {
    assert.equal(suggestPacks(10, []), null);
    assert.equal(suggestPacks(0, PUREE), null);
  });
});

describe("proposeAllocations (#70)", () => {
  const open = (id: string, itemId: string, date: string, quantity: number, allocated = 0): OpenRequirement => ({
    requirementId: id,
    itemId,
    serviceDate: date,
    quantity,
    allocated,
  });

  test("200 kg of goat splits across the two days that needed it", () => {
    const proposals = proposeAllocations(
      [{ lineItemId: "l-1", itemId: "i-goat", quantity: 200, lineTotal: 2800 }],
      [open("r-1", "i-goat", "2026-09-18", 120), open("r-2", "i-goat", "2026-09-21", 80)]
    );
    assert.deepEqual(proposals, [
      { lineItemId: "l-1", requirementId: "r-1", quantity: 120, amount: 1680 },
      { lineItemId: "l-1", requirementId: "r-2", quantity: 80, amount: 1120 },
    ]);
  });

  test("the earliest day is fed first, and what is left over stays unallocated", () => {
    const proposals = proposeAllocations(
      [{ lineItemId: "l-1", itemId: "i-goat", quantity: 200, lineTotal: 2000 }],
      [open("r-1", "i-goat", "2026-09-18", 120)]
    );
    assert.deepEqual(proposals, [{ lineItemId: "l-1", requirementId: "r-1", quantity: 120, amount: 1200 }]);
  });

  test("what has already been bought is not bought again", () => {
    const proposals = proposeAllocations(
      [{ lineItemId: "l-2", itemId: "i-onion", quantity: 50, lineTotal: 100 }],
      [open("r-3", "i-onion", "2026-09-18", 80, 60)]
    );
    assert.deepEqual(proposals, [{ lineItemId: "l-2", requirementId: "r-3", quantity: 20, amount: 40 }]);
  });

  test("a line for an item nothing is waiting on proposes nothing", () => {
    assert.deepEqual(
      proposeAllocations([{ lineItemId: "l-3", itemId: "i-tea", quantity: 5, lineTotal: 50 }], [
        open("r-1", "i-goat", "2026-09-18", 120),
      ]),
      []
    );
  });

  test("a line with no quantity still lands somewhere, whole", () => {
    const proposals = proposeAllocations(
      [{ lineItemId: "l-4", itemId: "i-goat", quantity: null, lineTotal: 500 }],
      [open("r-1", "i-goat", "2026-09-18", 120)]
    );
    assert.deepEqual(proposals, [{ lineItemId: "l-4", requirementId: "r-1", quantity: 120, amount: 500 }]);
  });
});

describe("progressOf", () => {
  test("what is bought, spent and still to come", () => {
    assert.deepEqual(
      progressOf({ quantity: 120 }, [
        { quantity: 100, amount: 1400 },
        { quantity: 10, amount: 150 },
      ]),
      { bought: 110, spent: 1550, outstanding: 10, complete: false }
    );
  });

  test("bought in full, and a little over", () => {
    assert.equal(progressOf({ quantity: 120 }, [{ quantity: 120, amount: 1680 }]).complete, true);
    assert.equal(progressOf({ quantity: 120 }, [{ quantity: 130, amount: 1820 }]).outstanding, 0);
  });

  test("nothing bought yet", () => {
    assert.deepEqual(progressOf({ quantity: 50 }, []), { bought: 0, spent: 0, outstanding: 50, complete: false });
  });
});

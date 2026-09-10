import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { summarisePackPrices, type PackPurchase } from "./pack-prices.ts";

const purchase = (overrides: Partial<PackPurchase>): PackPurchase => ({
  packSizeId: "box",
  lineTotal: 40,
  quantity: 1,
  receiptDate: "2026-09-01",
  submittedAt: "2026-09-01T09:00:00Z",
  ...overrides,
});

describe("summarisePackPrices", () => {
  test("divides by packs bought, not by what they hold", () => {
    // Two 6 kg boxes for $80 is $40 a box, not $6.67.
    const summary = summarisePackPrices([purchase({ lineTotal: 80, quantity: 2 })]).get("box");
    assert.deepEqual(summary, { purchaseCount: 1, latest: 40, average: 40 });
  });

  test("latest is by receipt date, average is across every purchase", () => {
    const summary = summarisePackPrices([
      purchase({ lineTotal: 42, receiptDate: "2026-09-01" }),
      purchase({ lineTotal: 80, quantity: 2, receiptDate: "2026-08-01" }),
    ]).get("box");
    assert.deepEqual(summary, { purchaseCount: 2, latest: 42, average: 41 });
  });

  test("an undated receipt is never the latest", () => {
    const summary = summarisePackPrices([
      purchase({ lineTotal: 50, receiptDate: null, submittedAt: "2026-09-10T09:00:00Z" }),
      purchase({ lineTotal: 40, receiptDate: "2026-08-01" }),
    ]).get("box");
    assert.equal(summary?.latest, 40);
  });

  test("the same receipt date falls back to when it was submitted", () => {
    const summary = summarisePackPrices([
      purchase({ lineTotal: 40, submittedAt: "2026-09-01T09:00:00Z" }),
      purchase({ lineTotal: 44, submittedAt: "2026-09-01T15:00:00Z" }),
    ]).get("box");
    assert.equal(summary?.latest, 44);
  });

  test("each pack is summarised on its own", () => {
    const summaries = summarisePackPrices([
      purchase({ packSizeId: "box", lineTotal: 40 }),
      purchase({ packSizeId: "loose", lineTotal: 14, quantity: 2 }),
    ]);
    assert.equal(summaries.get("box")?.latest, 40);
    assert.equal(summaries.get("loose")?.latest, 7);
  });

  test("a line with no packs bought is left out rather than divided by zero", () => {
    assert.equal(summarisePackPrices([purchase({ quantity: 0 })]).size, 0);
  });
});

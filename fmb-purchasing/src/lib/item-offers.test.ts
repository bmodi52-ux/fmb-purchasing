import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cheapestOfferId,
  priceDrift,
  sortOffers,
  summariseOfferPurchases,
  type OfferPurchase,
  type SortableOffer,
} from "./item-offers.ts";

const purchase = (overrides: Partial<OfferPurchase>): OfferPurchase => ({
  offerId: "woolworths",
  lineTotal: 13.75,
  quantity: 1,
  receiptDate: "2026-09-22",
  submittedAt: "2026-09-22T09:00:00Z",
  ...overrides,
});

describe("summariseOfferPurchases", () => {
  test("last paid is per pack, from the most recent receipt", () => {
    // Seven tubs for $106.75 is $15.25 a tub.
    const summary = summariseOfferPurchases([
      purchase({ lineTotal: 106.75, quantity: 7, receiptDate: "2026-09-22" }),
      purchase({ lineTotal: 12, receiptDate: "2026-08-01" }),
    ]).get("woolworths");
    assert.deepEqual(summary, { purchaseCount: 2, lastPaid: 15.25, lastPaidOn: "2026-09-22" });
  });

  test("each offer is summarised on its own", () => {
    const summaries = summariseOfferPurchases([
      purchase({ offerId: "woolworths", lineTotal: 13.75 }),
      purchase({ offerId: "taj", lineTotal: 13.99 }),
      purchase({ offerId: "taj", lineTotal: 27.98, quantity: 2, receiptDate: "2026-09-01" }),
    ]);
    assert.equal(summaries.get("woolworths")?.purchaseCount, 1);
    assert.deepEqual(summaries.get("taj"), { purchaseCount: 2, lastPaid: 13.99, lastPaidOn: "2026-09-22" });
  });

  test("the same receipt date falls back to when it was submitted", () => {
    const summary = summariseOfferPurchases([
      purchase({ lineTotal: 13, submittedAt: "2026-09-22T09:00:00Z" }),
      purchase({ lineTotal: 14, submittedAt: "2026-09-22T15:00:00Z" }),
    ]).get("woolworths");
    assert.equal(summary?.lastPaid, 14);
  });

  test("an undated receipt is never the latest", () => {
    const summary = summariseOfferPurchases([
      purchase({ lineTotal: 50, receiptDate: null, submittedAt: "2026-10-01T09:00:00Z" }),
      purchase({ lineTotal: 13.75 }),
    ]).get("woolworths");
    assert.equal(summary?.lastPaid, 13.75);
  });

  test("a line with no packs bought is left out rather than divided by zero", () => {
    assert.equal(summariseOfferPurchases([purchase({ quantity: 0 })]).size, 0);
  });

  test("an offer nobody has bought from has no summary", () => {
    assert.equal(summariseOfferPurchases([purchase({})]).get("abu-raby"), undefined);
  });
});

describe("priceDrift", () => {
  test("paid more than the price on file", () => {
    // $13.75 at the till against $12.35 on file.
    assert.equal(Math.round(priceDrift(13.75, 12.35)! * 100), 11);
  });

  test("paid less is negative", () => {
    assert.equal(priceDrift(9, 10), -0.1);
  });

  test("within a percent is not worth saying", () => {
    assert.equal(priceDrift(10.05, 10), null);
    assert.equal(priceDrift(13.99, 13.99), null);
  });

  test("nothing to compare", () => {
    assert.equal(priceDrift(null, 10), null);
    assert.equal(priceDrift(10, null), null);
    assert.equal(priceDrift(10, 0), null);
  });
});

describe("cheapestOfferId", () => {
  const offer = (id: string, costPerUnit: number | null, status = "approved") => ({ id, status, costPerUnit });

  test("the lowest cost per unit among approved offers", () => {
    assert.equal(cheapestOfferId([offer("taj", 2.8), offer("woolworths", 2.47), offer("abu-raby", 3.3)]), "woolworths");
  });

  test("a pending or rejected offer is never the cheapest", () => {
    assert.equal(
      cheapestOfferId([offer("taj", 2.8), offer("new", 1.5, "pending"), offer("old", 1, "rejected"), offer("abu-raby", 3.3)]),
      "taj"
    );
  });

  test("an item's only price is not called cheapest", () => {
    assert.equal(cheapestOfferId([offer("taj", 2.8)]), null);
    assert.equal(cheapestOfferId([offer("taj", 2.8), offer("unpriced", null)]), null);
    assert.equal(cheapestOfferId([]), null);
  });
});

describe("sortOffers", () => {
  const row = (vendorName: string | null, overrides: Partial<SortableOffer> = {}): SortableOffer => ({
    vendorName,
    brand: null,
    packQuantity: 5,
    packPrice: null,
    costPerUnit: null,
    lastPaid: null,
    purchaseCount: 0,
    ...overrides,
  });
  const names = (rows: SortableOffer[]) => rows.map((r) => r.vendorName);

  const rows = [
    row("Taj Mart", { costPerUnit: 2.8, purchaseCount: 4 }),
    row("No price yet"),
    row("Woolworths", { costPerUnit: 2.47, purchaseCount: 15 }),
    row("Abu Raby", { costPerUnit: 3.3, purchaseCount: 1 }),
  ];

  test("cheapest per unit first, and an unpriced offer last", () => {
    assert.deepEqual(names(sortOffers(rows, { key: "perUnit", direction: "asc" })), [
      "Woolworths",
      "Taj Mart",
      "Abu Raby",
      "No price yet",
    ]);
  });

  test("an unpriced offer stays last when the order is turned round", () => {
    assert.deepEqual(names(sortOffers(rows, { key: "perUnit", direction: "desc" })), [
      "Abu Raby",
      "Taj Mart",
      "Woolworths",
      "No price yet",
    ]);
  });

  test("by vendor, whatever the capitals", () => {
    const mixed = [row("WOOLWORTHS GROUP"), row("Taj Mart"), row(null), row("abu raby")];
    assert.deepEqual(names(sortOffers(mixed, { key: "vendor", direction: "asc" })), [
      "abu raby",
      "Taj Mart",
      "WOOLWORTHS GROUP",
      null,
    ]);
  });

  test("by pack, smallest first", () => {
    const packs = [row("ten", { packQuantity: 10 }), row("one", { packQuantity: 1 }), row("five", { packQuantity: 5 })];
    assert.deepEqual(names(sortOffers(packs, { key: "pack", direction: "asc" })), ["one", "five", "ten"]);
  });

  test("most bought first", () => {
    assert.equal(sortOffers(rows, { key: "bought", direction: "desc" })[0]?.vendorName, "Woolworths");
  });

  test("the list handed in is left as it was", () => {
    const before = names(rows);
    sortOffers(rows, { key: "perUnit", direction: "asc" });
    assert.deepEqual(names(rows), before);
  });
});

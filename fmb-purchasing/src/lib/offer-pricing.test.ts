import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { priceOn, saleEndFor, settlePrices } from "./offer-pricing";

describe("settlePrices (#29)", () => {
  test("a regular price, GST included, is kept as it is", () => {
    assert.deepEqual(settlePrices({ price: 37, regularPrice: null, gst: "included" }), {
      packPrice: 37,
      salePrice: null,
      gstBasis: "included",
    });
  });

  test("a special keeps both: the usual price as the price, the special beside it", () => {
    assert.deepEqual(settlePrices({ price: 8.5, regularPrice: 11, gst: "included" }), {
      packPrice: 11,
      salePrice: 8.5,
      gstBasis: "included",
    });
  });

  test("an ex-GST price has 10% added, to both prices", () => {
    assert.deepEqual(settlePrices({ price: 20, regularPrice: 25, gst: "excluded" }), {
      packPrice: 27.5,
      salePrice: 22,
      gstBasis: "added",
    });
  });

  test("a GST-free item is stored as read", () => {
    assert.equal(settlePrices({ price: 18, regularPrice: null, gst: "free" }).packPrice, 18);
  });

  test("a 'was' price that isn't higher is not a special", () => {
    assert.deepEqual(settlePrices({ price: 10, regularPrice: 10, gst: "included" }).salePrice, null);
  });
});

describe("saleEndFor (#29)", () => {
  // 2026-09-24 is a Thursday.
  test("Woolworths and Coles specials end on the next Tuesday", () => {
    assert.equal(saleEndFor("Woolworths", "2026-09-24"), "2026-09-29");
    assert.equal(saleEndFor("coles.com.au", "2026-09-24"), "2026-09-29");
  });
  test("read on a Tuesday, it ends that day", () => {
    assert.equal(saleEndFor("Coles", "2026-09-29"), "2026-09-29");
  });
  test("read on a Wednesday, it ends the Tuesday after", () => {
    assert.equal(saleEndFor("Woolworths", "2026-09-30"), "2026-10-06");
  });
  test("anywhere else, a week", () => {
    assert.equal(saleEndFor("Taj Mart", "2026-09-24"), "2026-10-01");
  });
});

describe("priceOn (#29)", () => {
  const offer = { packPrice: 11, salePrice: 8.5, saleEndsOn: "2026-09-30" };
  test("the special counts up to and including its last day", () => {
    assert.deepEqual(priceOn(offer, "2026-09-30"), { price: 8.5, onSpecial: true });
  });
  test("after it, the regular price, with nothing updated", () => {
    assert.deepEqual(priceOn(offer, "2026-10-01"), { price: 11, onSpecial: false });
  });
  test("no special, the regular price", () => {
    assert.deepEqual(priceOn({ packPrice: 11, salePrice: null, saleEndsOn: null }, "2026-09-30"), {
      price: 11,
      onSpecial: false,
    });
  });
});

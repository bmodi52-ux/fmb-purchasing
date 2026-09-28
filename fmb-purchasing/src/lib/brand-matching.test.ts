import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  brandKey,
  chooseOffer,
  offerForBrand,
  pinnedStoreOffer,
  type OfferOption,
  type StoreOffer,
} from "./line-matching.ts";
import { offerWordings } from "./expense-matching.ts";

/**
 * Which of a store's offers on a pack a receipt line is, when the store sells
 * that pack in more than one brand (#55).
 *
 * Raised from a real receipt: the same rice in the same 10 kg bag, in two
 * brands, on one receipt. Both lines were filed against one offer, so the
 * second brand's price was lost, and since #46 a later receipt for either
 * brand would replace the other's price.
 */

const offer = (id: string, brand: string | null, extra: Partial<OfferOption> = {}): OfferOption => ({
  id,
  packSizeId: "rice-10",
  brand,
  storeName: null,
  wordings: [],
  price: null,
  ...extra,
});

describe("brandKey", () => {
  test("case and spacing don't make a different brand", () => {
    assert.equal(brandKey("  Sun  Rice "), brandKey("sun rice"));
  });

  test("no brand is the empty key", () => {
    assert.equal(brandKey(null), "");
    assert.equal(brandKey("   "), "");
  });
});

describe("chooseOffer", () => {
  const tilda = offer("tilda", "Tilda");
  const sunrice = offer("sunrice", "SunRice");

  test("the brand the receipt printed picks its offer", () => {
    assert.deepEqual(chooseOffer([tilda, sunrice], { description: "BASMATI RICE 10KG", scannedBrand: "SUNRICE" }), {
      brand: "SunRice",
      confidence: "sure",
    });
  });

  test("a brand named on the line picks its offer", () => {
    assert.deepEqual(chooseOffer([tilda, sunrice], { description: "TILDA BASMATI 10KG", scannedBrand: null }), {
      brand: "Tilda",
      confidence: "sure",
    });
  });

  test("a misspelt brand on the line is worth a glance, not a guess", () => {
    const pick = chooseOffer([offer("mahatma", "Mahatma"), sunrice], {
      description: "MAHATMMA BASMATI 10KG",
      scannedBrand: null,
    });
    assert.deepEqual(pick, { brand: "Mahatma", confidence: "likely" });
  });

  test("a brand the store has no offer for is a new brand, with its own price", () => {
    assert.deepEqual(chooseOffer([tilda, sunrice], { description: "BASMATI RICE 10KG", scannedBrand: "Daawat" }), {
      brand: "Daawat",
      confidence: "likely",
    });
  });

  test("the only offer, with no brand recorded yet, is taken to be the brand the receipt names", () => {
    assert.deepEqual(
      chooseOffer([offer("unbranded", null)], { description: "BASMATI RICE 10KG", scannedBrand: "Tilda" }),
      { brand: "", confidence: "likely" }
    );
  });

  test("the only offer is the one when the line doesn't say", () => {
    assert.deepEqual(chooseOffer([tilda], { description: "BASMATI RICE 10KG", scannedBrand: null }), {
      brand: "Tilda",
      confidence: "sure",
    });
  });

  test("several brands and nothing to go on is asked", () => {
    assert.deepEqual(chooseOffer([tilda, sunrice], { description: "BASMATI RICE 10KG", scannedBrand: null }), {
      brand: null,
      confidence: "none",
    });
  });

  test("the store's own name for an offer, less the item's name, can pick it", () => {
    const pick = chooseOffer(
      [offer("tilda", "Tilda", { storeName: "Tilda Pure Basmati Rice 10kg" }), offer("sunrice", "SunRice")],
      { description: "PURE BASMATI 10KG", scannedBrand: null },
      "Basmati Rice"
    );
    assert.deepEqual(pick, { brand: "Tilda", confidence: "likely" });
  });

  test("a word both offers' names use sets neither apart", () => {
    const pick = chooseOffer(
      [
        offer("tilda", "Tilda", { storeName: "Tilda Pure Basmati Rice 10kg" }),
        offer("sunrice", "SunRice", { storeName: "SunRice Pure Basmati 10kg" }),
      ],
      { description: "PURE BASMATI 10KG", scannedBrand: null },
      "Basmati Rice"
    );
    assert.deepEqual(pick, { brand: null, confidence: "none" });
  });

  test("what the store's receipts have called an offer can pick it", () => {
    const pick = chooseOffer(
      [offer("tilda", "Tilda", { wordings: ["GRN BASMATI 10KG"] }), sunrice],
      { description: "GRN BASMATI 10 KG", scannedBrand: null },
      "Basmati Rice"
    );
    assert.deepEqual(pick, { brand: "Tilda", confidence: "likely" });
  });

  test("the longer of two brands both on the line is the one it names", () => {
    const pick = chooseOffer([offer("plain", "Sun Rice"), offer("premium", "Sun Rice Premium")], {
      description: "SUN RICE PREMIUM BASMATI",
      scannedBrand: null,
    });
    assert.deepEqual(pick, { brand: "Sun Rice Premium", confidence: "likely" });
  });

  test("a pack the store doesn't sell yet takes the brand the receipt printed, or none", () => {
    assert.deepEqual(chooseOffer([], { description: "BASMATI", scannedBrand: " Tilda " }), { brand: "Tilda", confidence: "sure" });
    assert.deepEqual(chooseOffer([], { description: "BASMATI", scannedBrand: null }), { brand: "", confidence: "sure" });
  });
});

describe("pinnedStoreOffer", () => {
  const storeOffer = (id: string, brand: string, vendorSku: string | null = null): StoreOffer => ({
    ...offer(id, brand),
    itemId: "rice",
    vendorSku,
  });
  const offers = [storeOffer("tilda", "Tilda", "TL-10"), storeOffer("sunrice", "SunRice", "SR-10")];

  test("a product code one offer carries is that offer", () => {
    assert.equal(pinnedStoreOffer({ description: "RICE", productCode: " sr-10 " }, offers, [])?.id, "sunrice");
  });

  test("this store's exact wording, remembered against one offer, is that offer", () => {
    const wordings = [{ description: "Basmati  Rice 10kg", offerId: "tilda" }];
    assert.equal(pinnedStoreOffer({ description: "BASMATI RICE 10KG", productCode: null }, offers, wordings)?.id, "tilda");
  });

  test("a wording remembered against two offers settles nothing", () => {
    const wordings = [
      { description: "BASMATI RICE 10KG", offerId: "tilda" },
      { description: "basmati rice 10kg", offerId: "sunrice" },
    ];
    assert.equal(pinnedStoreOffer({ description: "BASMATI RICE 10KG", productCode: null }, offers, wordings), null);
  });

  test("a wording remembered against an offer the store no longer has settles nothing", () => {
    const wordings = [{ description: "BASMATI RICE 10KG", offerId: "rejected-one" }];
    assert.equal(pinnedStoreOffer({ description: "BASMATI RICE 10KG", productCode: null }, offers, wordings), null);
  });
});

describe("offerForBrand", () => {
  const live = [
    { id: "tilda", status: "approved", createdAt: "2026-08-01", brand: "Tilda" },
    { id: "sunrice", status: "pending", createdAt: "2026-07-01", brand: "SunRice" },
  ];

  test("the brand the form settled on files against that brand's offer", () => {
    assert.deepEqual(offerForBrand(live, "sunrice", "Tilda"), { offerId: "sunrice" });
  });

  test("a brand the form settled on that the store has no offer for adds one", () => {
    assert.deepEqual(offerForBrand(live, " Daawat ", null), { newBrand: "Daawat" });
  });

  test("no brand, settled on, is the offer with none", () => {
    assert.deepEqual(offerForBrand([...live, { id: "plain", status: "pending", createdAt: "2026-09-01", brand: null }], "", null), {
      offerId: "plain",
    });
    assert.deepEqual(offerForBrand(live, "", null), { newBrand: null });
  });

  test("without a choice, the brand the receipt printed decides", () => {
    assert.deepEqual(offerForBrand(live, undefined, "TILDA"), { offerId: "tilda" });
    assert.deepEqual(offerForBrand(live, undefined, "Daawat"), { newBrand: "Daawat" });
  });

  test("the store's only offer, with no brand yet, takes the receipt's brand", () => {
    assert.deepEqual(offerForBrand([{ id: "plain", status: "pending", createdAt: "2026-09-01", brand: null }], undefined, "Tilda"), {
      offerId: "plain",
    });
  });

  test("with nothing to go on, the reviewed offer, as before", () => {
    assert.deepEqual(offerForBrand(live, undefined, null), { offerId: "tilda" });
    assert.deepEqual(offerForBrand([], undefined, null), { newBrand: null });
  });

  test("a rejected offer is never reused", () => {
    assert.deepEqual(offerForBrand([{ ...live[0]!, status: "rejected" }], "Tilda", null), { newBrand: "Tilda" });
  });
});

describe("offerWordings", () => {
  test("each wording remembers the offer its line went to", () => {
    const map = offerWordings([
      { description: "TILDA BASMATI 10KG", offerId: "tilda" },
      { description: "SUNRICE BASMATI 10KG", offerId: "sunrice" },
    ]);
    assert.equal(map.get("tilda basmati 10kg")?.offerId, "tilda");
    assert.equal(map.get("sunrice basmati 10kg")?.offerId, "sunrice");
  });

  test("one wording on one receipt for two brands remembers neither", () => {
    const map = offerWordings([
      { description: "BASMATI RICE 10KG", offerId: "tilda" },
      { description: "Basmati Rice 10kg", offerId: "sunrice" },
    ]);
    assert.equal(map.get("basmati rice 10kg")?.offerId, null);
  });

  test("the same wording bought twice in one brand is still that brand", () => {
    const map = offerWordings([
      { description: "TILDA BASMATI 10KG", offerId: "tilda" },
      { description: "TILDA BASMATI 10KG", offerId: "tilda" },
    ]);
    assert.equal(map.get("tilda basmati 10kg")?.offerId, "tilda");
  });

  test("what the scan read before a correction is remembered too", () => {
    const map = offerWordings([
      { description: "Tilda Basmati 10kg", originalDescription: "TLDA BASMTI 10KG", offerId: "tilda" },
    ]);
    assert.equal(map.get("tlda basmti 10kg")?.offerId, "tilda");
  });

  test("a line filed against no offer teaches nothing", () => {
    assert.equal(offerWordings([{ description: "CARD SURCHARGE", offerId: null }]).size, 0);
  });
});

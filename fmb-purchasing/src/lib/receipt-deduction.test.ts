import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyDeduction } from "./receipt-deduction";
import type { ExtractedLineItem } from "./receipt-extraction";

const goods = (description: string, lineTotal: number): ExtractedLineItem => ({
  description,
  kind: "goods",
  quantity: null,
  unitPrice: null,
  lineTotal,
  category: null,
  normalizedQuantity: null,
  normalizedUnit: null,
  gstApplicable: false,
});

const receipt = (total: number | null, ...lines: ExtractedLineItem[]) => ({ total, lineItems: lines, note: null });

describe("applyDeduction (#61)", () => {
  test("the Campbells voucher: the total becomes what the card was charged", () => {
    const r = applyDeduction(receipt(1498.31, goods("Groceries", 1490.24), goods("Visa surcharge", 8.07)), 1423.8, "Customer Voucher 5");
    assert.equal(r.total, 1423.8);
    assert.equal(r.lineItems.length, 3);
    assert.deepEqual(
      { d: r.lineItems[2].description, k: r.lineItems[2].kind, t: r.lineItems[2].lineTotal, gst: r.lineItems[2].gstApplicable },
      { d: "Customer Voucher 5", k: "discount", t: -74.51, gst: false }
    );
    assert.equal(
      r.lineItems.reduce((s, l) => s + (l.lineTotal ?? 0), 0).toFixed(2),
      r.total.toFixed(2),
      "the lines still account for the total"
    );
  });

  test("nothing deducted leaves the reading alone", () => {
    const before = receipt(100, goods("Milk", 100));
    assert.equal(applyDeduction(before, null, null), before);
    assert.equal(applyDeduction(before, 100, null), before);
    assert.equal(applyDeduction(before, 99.995, null), before, "a rounding-sized gap is not a voucher");
  });

  test("an amount larger than the total is not a discount", () => {
    const before = receipt(100, goods("Milk", 100));
    assert.equal(applyDeduction(before, 108.07, "Visa surcharge"), before);
  });

  test("an unnamed deduction still gets a line", () => {
    const r = applyDeduction(receipt(50, goods("Rice", 50)), 45, "  ");
    assert.equal(r.lineItems[1].description, "Voucher or credit applied");
    assert.equal(r.lineItems[1].lineTotal, -5);
  });

  test("no total means nothing to work from", () => {
    const before = receipt(null, goods("Rice", 50));
    assert.equal(applyDeduction(before, 45, "Voucher"), before);
  });
});

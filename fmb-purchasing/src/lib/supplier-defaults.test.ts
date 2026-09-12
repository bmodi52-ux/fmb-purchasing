import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { applyLineDefaults, hasDefaults, NO_DEFAULTS } from "./supplier-defaults.ts";

const line = (over: Partial<{ kind: string; categoryName: string | null; gstApplicable: boolean; lineTotal: number }>) => ({
  kind: "goods",
  categoryName: null as string | null,
  gstApplicable: true,
  lineTotal: 10,
  ...over,
});

describe("applyLineDefaults", () => {
  test("fills a missing category but never replaces one the receipt gave", () => {
    const { lines, changes } = applyLineDefaults(
      [line({}), line({ categoryName: "Dairy & Eggs" })],
      { categoryName: "Meat & Poultry", payee: null, gstTreatment: null }
    );
    assert.deepEqual(
      lines.map((l) => l.categoryName),
      ["Meat & Poultry", "Dairy & Eggs"]
    );
    assert.deepEqual(changes, ["1 line filed under Meat & Poultry"]);
  });

  test("a GST-free vendor's lines lose GST; the app's own remainder is left alone", () => {
    const { lines, changes } = applyLineDefaults(
      [line({}), line({ gstApplicable: false }), line({ kind: "unallocated" })],
      { categoryName: null, payee: null, gstTreatment: "gst_free" }
    );
    assert.deepEqual(
      lines.map((l) => l.gstApplicable),
      [false, false, true]
    );
    assert.deepEqual(changes, ["1 line marked GST-free"]);
  });

  test("nothing to say when there are no defaults", () => {
    assert.equal(hasDefaults(NO_DEFAULTS), false);
    assert.equal(hasDefaults({ ...NO_DEFAULTS, payee: "vendor" }), true);
    assert.deepEqual(applyLineDefaults([line({})], NO_DEFAULTS).changes, []);
  });
});

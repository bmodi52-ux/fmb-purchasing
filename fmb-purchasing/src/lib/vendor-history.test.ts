import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { diffFields, vendorChangeTitle, vendorValueText } from "./vendor-history.ts";

describe("vendor history", () => {
  test("only fields that really changed, addresses compared by content", () => {
    const before: Record<string, unknown> = { name: "Taj Mart", abn: null, billing_address: { line1: "1 Main St", suburb: "Auburn" } };
    const changes = diffFields(
      before,
      { name: "Taj Mart", abn: "", billing_address: { line1: "2 Main St", suburb: "Auburn" } },
      ["name", "abn", "billing_address"]
    );
    assert.deepEqual(Object.keys(changes), ["billing_address"]);
  });

  test("reads as words", () => {
    assert.equal(vendorChangeTitle("contact_added", { label: "Yusuf" }), "Contact added: Yusuf");
    const lookups = { categoryName: (id: string) => (id === "c1" ? "Meat & Poultry" : null) };
    assert.equal(vendorValueText("default_category_id", "c1", lookups), "Meat & Poultry");
    assert.equal(vendorValueText("billing_address", { line1: "1 Main St", line2: null, suburb: "Auburn" }, lookups), "1 Main St, Auburn");
    assert.equal(vendorValueText("abn", null, lookups), "—");
  });
});

describe("addresses from the database", () => {
  test("the same address in a different key order is not a change", () => {
    const stored: Record<string, unknown> = { billing_address: { state: "NSW", line1: "1 Main St" } };
    assert.deepEqual(diffFields(stored, { billing_address: { line1: "1 Main St", state: "NSW" } }, ["billing_address"]), {});
  });
});

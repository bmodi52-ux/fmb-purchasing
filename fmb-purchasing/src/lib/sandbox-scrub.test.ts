import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildTextScrubber,
  scrubDeep,
  scrubbedAbn,
  scrubbedBsb,
  scrubbedEmail,
  scrubbedPersonName,
  scrubbedVendorName,
  withoutGeneratedColumns,
} from "./sandbox-scrub.ts";

describe("pseudonyms", () => {
  test("the same id always gives the same fake name, and different ids differ", () => {
    assert.equal(scrubbedVendorName("vendor-1"), scrubbedVendorName("vendor-1"));
    assert.notEqual(scrubbedVendorName("vendor-1"), scrubbedVendorName("vendor-2"));
    assert.match(scrubbedVendorName("vendor-1"), /^[A-Z][a-z]+ [A-Z][a-z]+$/);
    assert.match(scrubbedPersonName("user-1"), /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  test("nothing invented can reach a real inbox or a real bank", () => {
    assert.match(scrubbedEmail("user-1"), /@sandbox\.invalid$/);
    assert.match(scrubbedAbn("vendor-1"), /^\d{11}$/);
    // 999 is an unallocated BSB prefix, so no real bank is named.
    assert.match(scrubbedBsb("vendor-1"), /^999\d{3}$/);
  });
});

describe("free text", () => {
  const scrub = buildTextScrubber([
    { from: "Fresh Poultry Pty Ltd", to: "Auburn Poultry" },
    { from: "Fresh Poultry", to: "Auburn Poultry" },
    { from: "Miqdad", to: "Bilal Ansari" },
  ]);

  test("the longest name wins, so a shorter one cannot half-match inside it", () => {
    assert.equal(scrub("Invoice from Fresh Poultry Pty Ltd today"), "Invoice from Auburn Poultry today");
  });

  test("names are replaced whatever their case, mid-sentence", () => {
    assert.equal(scrub("please pay miqdad for the produce"), "please pay Bilal Ansari for the produce");
  });

  test("text with nothing to hide is left exactly as it was", () => {
    assert.equal(scrub("Chicken thigh fillet 10kg"), "Chicken thigh fillet 10kg");
  });

  test("it reaches into nested JSON, the shape vendor history is stored in", () => {
    const changes = { name: { old: "Fresh Poultry", new: "Fresh Poultry Pty Ltd" }, counts: [1, 2] };
    assert.deepEqual(scrubDeep(changes, scrub), {
      name: { old: "Auburn Poultry", new: "Auburn Poultry" },
      counts: [1, 2],
    });
  });

  test("a scrubber with nothing to replace changes nothing", () => {
    assert.equal(buildTextScrubber([])("anything at all"), "anything at all");
    // Two characters is too short to replace safely: it would rewrite words.
    assert.equal(buildTextScrubber([{ from: "Jo", to: "X" }])("Job done"), "Job done");
  });
});

describe("columns the database generates", () => {
  test("the numbering columns are dropped, so the sandbox assigns its own", () => {
      const item = { id: "i1", name: "Rice", item_seq: 42, item_number: "GRO-0042", category_id: "c1" };
    assert.deepEqual(withoutGeneratedColumns("items", item), { id: "i1", name: "Rice", category_id: "c1" });

    const expense = { id: "e1", expense_seq: 7, expense_number: "E-0007", total: 10 };
    assert.deepEqual(withoutGeneratedColumns("expenses", expense), { id: "e1", total: 10 });
  });

  test("a table with nothing generated is passed through untouched", () => {
    const row = { id: "p1", display_name: "Someone" };
    assert.equal(withoutGeneratedColumns("payees", row), row);
  });
});

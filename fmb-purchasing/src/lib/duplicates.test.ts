import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { duplicateLabel, matchDuplicates } from "./duplicates.ts";

describe("matchDuplicates", () => {
  const expenses = [
    { id: "a", vendor_id: "v1", invoice_number: "INV-7" },
    { id: "b", vendor_id: "v1", invoice_number: "inv-7 " },
    { id: "c", vendor_id: "v2", invoice_number: "INV-7" },
  ];

  test("the same invoice number from the same vendor, ignoring case and spacing", () => {
    const found = matchDuplicates(expenses, [], [], [
      { id: "a", expense_number: "E-1", status: "submitted", vendor_id: "v1", invoice_number: "INV-7" },
      { id: "b", expense_number: "E-2", status: "submitted", vendor_id: "v1", invoice_number: "inv-7 " },
      { id: "c", expense_number: "E-3", status: "submitted", vendor_id: "v2", invoice_number: "INV-7" },
    ]);
    assert.deepEqual(found.get("a")?.map((m) => m.expenseId), ["b"]);
    assert.deepEqual(found.get("b")?.map((m) => m.expenseId), ["a"]);
    // A different vendor's INV-7 is a different invoice.
    assert.equal(found.get("c"), undefined);
  });

  test("the same file on another expense, never matching itself", () => {
    const found = matchDuplicates(
      [{ id: "a", vendor_id: null, invoice_number: null }],
      [{ expense_id: "a", sha256: "f00" }],
      [
        { expense_id: "a", sha256: "f00", expense: { id: "a", expense_number: "E-1", status: "submitted" } },
        { expense_id: "z", sha256: "f00", expense: { id: "z", expense_number: "E-9", status: "paid" } },
      ],
      []
    );
    assert.deepEqual(found.get("a"), [{ expenseId: "z", expenseNumber: "E-9", status: "paid", reason: "same-file" }]);
  });

  test("one entry per other expense, even when both reasons apply", () => {
    const found = matchDuplicates(
      [{ id: "a", vendor_id: "v1", invoice_number: "X" }],
      [{ expense_id: "a", sha256: "f00" }],
      [{ expense_id: "z", sha256: "f00", expense: { id: "z", expense_number: "E-9", status: "paid" } }],
      [{ id: "z", expense_number: "E-9", status: "paid", vendor_id: "v1", invoice_number: "X" }]
    );
    assert.equal(found.get("a")?.length, 1);
  });
});

describe("duplicateLabel", () => {
  test("names up to two, then counts the rest", () => {
    const m = (n: string) => ({ expenseId: n, expenseNumber: n, status: "paid", reason: "same-file" as const });
    assert.equal(duplicateLabel([m("E-1")]), "Possible duplicate of E-1");
    assert.equal(duplicateLabel([m("E-1"), m("E-2"), m("E-3")]), "Possible duplicate of E-1, E-2 and 1 more");
  });
});

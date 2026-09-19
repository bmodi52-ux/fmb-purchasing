import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { describeSources, type DescriptionRow, type ItemLine } from "./description-sources";

const KMA = "vendor-kma";
const BLF = "vendor-blf";

function desc(id: string, description: string, vendorId: string | null = KMA): DescriptionRow {
  return { id, vendorId, description, createdAt: "2026-09-01T00:00:00Z", createdBy: "user-1" };
}

function line(expenseId: string, description: string, date: string, vendorId: string | null = KMA): ItemLine {
  return { expenseId, expenseNumber: expenseId.toUpperCase(), vendorId, description, date };
}

describe("describeSources", () => {
  test("a vendor's wording points at the latest of that vendor's receipts saying it", () => {
    const sources = describeSources(
      [desc("d1", "Ginger Box 2×10kg")],
      [
        line("e-1", "GINGER BOX  2×10KG", "2026-08-01"),
        line("e-2", "Ginger Box 2×10kg", "2026-09-10"),
        line("e-3", "Ginger Box 2×10kg", "2026-09-12", BLF),
      ],
      []
    );
    const s = sources.get("d1");
    assert.equal(s?.kind, "receipt");
    assert.equal(s?.kind === "receipt" && s.latest.expenseId, "e-2", "another vendor's receipt is not this one's source");
    assert.equal(s?.kind === "receipt" && s.expenseCount, 2);
  });

  test("the same expense saying it twice counts once", () => {
    const s = describeSources(
      [desc("d1", "Okra")],
      [line("e-1", "Okra", "2026-08-01"), line("e-1", "okra", "2026-08-01")],
      []
    ).get("d1");
    assert.equal(s?.kind === "receipt" && s.expenseCount, 1);
  });

  test("a vendorless wording matches any vendor's receipt", () => {
    const s = describeSources([desc("d1", "Lamb Mince", null)], [line("e-1", "Lamb Mince", "2026-08-01", BLF)], []).get(
      "d1"
    );
    assert.equal(s?.kind, "receipt");
  });

  test("an old name nobody's receipt uses is shown as kept from the rename", () => {
    const s = describeSources(
      [desc("d1", "LAMB MINCE 1KG", null)],
      [],
      [{ oldName: "Lamb mince 1kg", newName: "Lamb Mince", changedAt: "2026-09-19T12:00:00Z" }]
    ).get("d1");
    assert.deepEqual(s, { kind: "rename", renamedTo: "Lamb Mince", renamedAt: "2026-09-19T12:00:00Z" });
  });

  test("a vendor's wording is never taken for an old name", () => {
    const s = describeSources(
      [desc("d1", "Lamb mince 1kg")],
      [],
      [{ oldName: "Lamb mince 1kg", newName: "Lamb Mince", changedAt: "2026-09-19T12:00:00Z" }]
    ).get("d1");
    assert.equal(s?.kind, "added");
  });

  test("anything else was added by hand or from a product photo", () => {
    const s = describeSources([desc("d1", "Bekaa Yoghurt 5kg")], [], []).get("d1");
    assert.deepEqual(s, { kind: "added", createdBy: "user-1", createdAt: "2026-09-01T00:00:00Z" });
  });
});

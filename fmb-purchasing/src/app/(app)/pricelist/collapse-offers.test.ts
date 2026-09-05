import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { collapseToItems, type CollapsibleOffer } from "./collapse-offers.ts";

type Row = CollapsibleOffer & { id: string };

function offer(id: string, itemId: string, cost: number | null, status = "approved", vendor = id): Row {
  return { id, itemId, costPerBaseUnit: cost, status, vendorLabel: vendor };
}

const HIDDEN = new Set(["item_number", "name", "category"]);
const SHOWN = new Set(["item_number", "name", "category", "vendor"]);

describe("collapseToItems", () => {
  test("leaves every offer alone while the Vendor column is shown", () => {
    const rows = [offer("a", "rice", 2), offer("b", "rice", 3), offer("c", "flour", 1)];
    assert.equal(collapseToItems(rows, SHOWN), rows, "the same array, not a copy");
  });

  test("keeps one row per item when the Vendor column is hidden", () => {
    const rows = [offer("a", "rice", 2), offer("b", "rice", 3), offer("c", "flour", 1)];
    const out = collapseToItems(rows, HIDDEN);

    assert.equal(out.length, 2);
    assert.deepEqual(
      out.map((r) => r.itemId),
      ["rice", "flour"],
      "input order is preserved so a column sort is not undone"
    );
  });

  test("keeps the cheapest offer as the item's face", () => {
    const rows = [offer("dear", "rice", 9), offer("cheap", "rice", 2), offer("mid", "rice", 5)];
    const [row] = collapseToItems(rows, HIDDEN);
    assert.equal(row.id, "cheap");
  });

  test("says how many offers the surviving row stands for", () => {
    const rows = [offer("a", "rice", 2), offer("b", "rice", 3), offer("c", "rice", 4)];
    const [row] = collapseToItems(rows, HIDDEN);
    assert.equal(row.otherOfferCount, 2, "three offers, so two others");
  });

  test("leaves otherOfferCount unset for a single-offer item", () => {
    const [row] = collapseToItems([offer("only", "rice", 2)], HIDDEN);
    assert.equal(row.otherOfferCount, undefined, "'+0 more' would be noise on most rows");
  });

  test("never lets a rejected offer represent an item, however cheap", () => {
    // The whole reason status outranks price: a rejected offer is not a price
    // anyone can act on, so showing it as the item's cost would be a lie.
    const rows = [offer("rejected", "rice", 0.5, "rejected"), offer("approved", "rice", 4, "approved")];
    const [row] = collapseToItems(rows, HIDDEN);
    assert.equal(row.id, "approved");
  });

  test("prefers an approved offer over a cheaper pending one", () => {
    const rows = [offer("pending", "rice", 1, "pending"), offer("approved", "rice", 4, "approved")];
    const [row] = collapseToItems(rows, HIDDEN);
    assert.equal(row.id, "approved");
  });

  test("falls back to a pending offer when nothing is approved", () => {
    const rows = [offer("rejected", "rice", 1, "rejected"), offer("pending", "rice", 4, "pending")];
    const [row] = collapseToItems(rows, HIDDEN);
    assert.equal(row.id, "pending");
  });

  test("treats an unpriced offer as the most expensive, not the cheapest", () => {
    // null sorting first would hand the row to an offer with no price at all.
    const rows = [offer("unpriced", "rice", null), offer("priced", "rice", 7)];
    const [row] = collapseToItems(rows, HIDDEN);
    assert.equal(row.id, "priced");
  });

  test("breaks a price tie on vendor name, so the order is stable", () => {
    const rows = [offer("z", "rice", 2, "approved", "Zahra"), offer("a", "rice", 2, "approved", "Ali")];
    const [row] = collapseToItems(rows, HIDDEN);
    assert.equal(row.id, "a");
  });

  test("does not mutate the rows it was given", () => {
    const rows = [offer("a", "rice", 2), offer("b", "rice", 3)];
    const snapshot = JSON.parse(JSON.stringify(rows));
    collapseToItems(rows, HIDDEN);
    assert.deepEqual(rows, snapshot);
  });

  test("handles an empty table", () => {
    assert.deepEqual(collapseToItems([] as Row[], HIDDEN), []);
  });
});

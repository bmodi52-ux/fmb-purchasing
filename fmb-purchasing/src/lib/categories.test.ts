import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { sortCategories, leafCategories, categoryLabelsById, type CategoryRow } from "./categories.ts";

function cat(id: string, name: string, parent: string | null = null): CategoryRow {
  return { id, name, parent_category_id: parent };
}

/**
 * The order categories appear in, everywhere they are listed.
 *
 * Previously whatever sort_order happened to hold — a column nothing in the
 * app can set — so the list read as the order categories were created in.
 */
describe("sortCategories", () => {
  test("puts top-level categories in alphabetical order", () => {
    const rows = [cat("m", "Meat & Poultry"), cat("b", "Bakery"), cat("g", "Groceries")];
    assert.deepEqual(
      sortCategories(rows).map((c) => c.name),
      ["Bakery", "Groceries", "Meat & Poultry"]
    );
  });

  test("keeps a subcategory under its parent, not under its own initial", () => {
    // Beef would otherwise sort above Bakery and be read as a top-level thing.
    const rows = [cat("bak", "Bakery"), cat("m", "Meat & Poultry"), cat("beef", "Beef", "m")];
    assert.deepEqual(
      sortCategories(rows).map((c) => c.name),
      ["Bakery", "Meat & Poultry", "Beef"]
    );
  });

  test("sorts siblings alphabetically within their parent", () => {
    const rows = [
      cat("m", "Meat & Poultry"),
      cat("mut", "Mutton", "m"),
      cat("chk", "Chicken", "m"),
      cat("lam", "Lamb", "m"),
      cat("bef", "Beef", "m"),
    ];
    assert.deepEqual(
      sortCategories(rows).map((c) => c.name),
      ["Meat & Poultry", "Beef", "Chicken", "Lamb", "Mutton"]
    );
  });

  test("ignores case, so a lowercase entry is not exiled to the end", () => {
    const rows = [cat("a", "apples"), cat("b", "Bakery"), cat("c", "Cleaning")];
    assert.deepEqual(
      sortCategories(rows).map((c) => c.name),
      ["apples", "Bakery", "Cleaning"]
    );
  });

  test("does not mutate the array it was given", () => {
    const rows = [cat("z", "Zaatar"), cat("a", "Apples")];
    sortCategories(rows);
    assert.deepEqual(
      rows.map((c) => c.name),
      ["Zaatar", "Apples"]
    );
  });

  test("handles an empty list", () => {
    assert.deepEqual(sortCategories([]), []);
  });

  test("leaves the tree intact for the pickers built from it", () => {
    const rows = [cat("m", "Meat & Poultry"), cat("chk", "Chicken", "m"), cat("bak", "Bakery")];
    const sorted = sortCategories(rows);
    assert.deepEqual(
      leafCategories(sorted).map((c) => c.name),
      ["Bakery", "Chicken"],
      "a parent is still a grouping node, and leaves come out sorted"
    );
    assert.equal(categoryLabelsById(sorted).get("chk"), "Meat & Poultry › Chicken");
  });
});

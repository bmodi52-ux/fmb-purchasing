import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  sortCategories,
  leafCategories,
  categoryLabelsById,
  categoriesForLineGroup,
  lineGroupFor,
  type CategoryRow,
} from "./categories.ts";

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

/**
 * Which categories a line's kind puts in front of you.
 *
 * The picker used to offer all nineteen whatever the line was, so a bag of
 * rice was chosen past Professional & Contractor Services and a plumber past
 * Dairy & Eggs.
 */
describe("categoriesForLineGroup", () => {
  const groceries = { name: "Groceries", appliesTo: ["goods"] };
  const repairs = { name: "Maintenance & Repairs", appliesTo: ["service"] };
  const cleaning = { name: "Cleaning & Sanitation", appliesTo: ["goods", "service"] };
  const transport = { name: "Transport & Logistics", appliesTo: ["service", "charge"] };
  const untagged = { name: "New Category", appliesTo: null };
  const all = [groceries, repairs, cleaning, transport, untagged];

  test("puts a goods line's categories first", () => {
    const { relevant } = categoriesForLineGroup(all, "goods");
    assert.deepEqual(relevant.map((c) => c.name), ["Groceries", "Cleaning & Sanitation", "New Category"]);
  });

  test("puts a service line's categories first", () => {
    const { relevant } = categoriesForLineGroup(all, "service");
    assert.deepEqual(
      relevant.map((c) => c.name),
      ["Maintenance & Repairs", "Cleaning & Sanitation", "Transport & Logistics", "New Category"]
    );
  });

  test("keeps every other category reachable rather than dropping it", () => {
    // A category tagged wrongly must not make an expense impossible to file.
    const { relevant, others } = categoriesForLineGroup(all, "charge");
    assert.deepEqual(relevant.map((c) => c.name), ["Transport & Logistics", "New Category"]);
    assert.deepEqual(
      others.map((c) => c.name),
      ["Groceries", "Maintenance & Repairs", "Cleaning & Sanitation"],
      "nothing is lost; it is only further down"
    );
  });

  test("treats an untagged category as relevant to everything", () => {
    for (const group of ["goods", "service", "charge"] as const) {
      const { relevant } = categoriesForLineGroup([untagged], group);
      assert.equal(relevant.length, 1, `untagged should still appear for ${group}`);
    }
  });

  test("preserves the order it was given, which is already sorted", () => {
    const { relevant } = categoriesForLineGroup([cleaning, groceries], "goods");
    assert.deepEqual(relevant.map((c) => c.name), ["Cleaning & Sanitation", "Groceries"]);
  });
});

describe("lineGroupFor", () => {
  test("maps goods and services to their own groups", () => {
    assert.equal(lineGroupFor("goods"), "goods");
    assert.equal(lineGroupFor("service"), "service");
  });

  test("maps every charge kind to one group", () => {
    // They all want the same short list; four columns of the same answer would
    // be four things to keep in step.
    for (const kind of ["surcharge", "delivery", "discount", "rounding", "deposit", "unallocated"]) {
      assert.equal(lineGroupFor(kind), "charge");
    }
  });
});

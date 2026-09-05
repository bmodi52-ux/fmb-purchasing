import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isWorthRemembering } from "./expense-matching.ts";

/**
 * Which submitter edits teach the app a new receipt wording.
 *
 * A correction used to be recorded only as its outcome — the tidy text a human
 * typed was remembered against the item, and the misreading that made them
 * type it was thrown away. The same vendor printing the same awkward text next
 * month then failed to match all over again, however many times somebody had
 * already fixed it.
 */
describe("isWorthRemembering", () => {
  test("remembers a genuine correction", () => {
    assert.equal(isWorthRemembering("Chckn Thgh 5Kg", "Chicken Thigh 5kg"), true);
  });

  test("ignores a line the submitter left exactly as read", () => {
    assert.equal(isWorthRemembering("Chicken Thigh 5kg", "Chicken Thigh 5kg"), false);
  });

  test("ignores a case-only edit", () => {
    // Matching normalizes case, so this would have matched regardless.
    assert.equal(isWorthRemembering("CHICKEN THIGH", "Chicken Thigh"), false);
  });

  test("ignores a whitespace-only edit", () => {
    assert.equal(isWorthRemembering("Chicken   Thigh  ", "Chicken Thigh"), false);
  });

  test("ignores manually entered lines, which have no earlier reading", () => {
    assert.equal(isWorthRemembering(null, "Chicken Thigh"), false);
    assert.equal(isWorthRemembering(undefined, "Chicken Thigh"), false);
  });

  test("ignores an original that was blank or only spaces", () => {
    assert.equal(isWorthRemembering("", "Chicken Thigh"), false);
    assert.equal(isWorthRemembering("   ", "Chicken Thigh"), false);
  });

  test("remembers when a submitter replaces the description entirely", () => {
    // Extraction sometimes grabs a heading or a code rather than the product.
    assert.equal(isWorthRemembering("ITEM 4", "Basmati Rice 20kg"), true);
  });

  test("remembers a correction that only adds detail", () => {
    assert.equal(isWorthRemembering("Chicken", "Chicken Thigh 5kg"), true);
  });
});

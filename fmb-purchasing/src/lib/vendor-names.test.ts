import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { abnsCompatible, isValidAbn, vendorLabel, vendorNameKeys, vendorNamesMatch } from "./vendor-names.ts";

describe("isValidAbn (#45)", () => {
  test("Nimco Foods' real ABN passes; the misread one fails", () => {
    assert.equal(isValidAbn("37 003 900 427"), true);
    assert.equal(isValidAbn("03003900427"), false);
  });

  test("ALDI's ABN passes", () => {
    assert.equal(isValidAbn("90196565019"), true);
  });

  test("anything but eleven digits fails", () => {
    assert.equal(isValidAbn("3700390042"), false);
    assert.equal(isValidAbn(""), false);
  });
});

describe("vendorNamesMatch (#45)", () => {
  test("a trading name matches the registered 'X T/A Y'", () => {
    assert.equal(vendorNamesMatch("Nimco Foods", "FULBECK PTY. LIMITED T/A Nimco Foods"), true);
  });

  test("case, punctuation and entity words are ignored", () => {
    assert.equal(vendorNamesMatch("ALDI STORES", "ALDI STORES (A LIMITED PARTNERSHIP)"), true);
    assert.equal(vendorNamesMatch("Harkola Pty Ltd", "HARKOLA PTY. LTD."), true);
  });

  test("different businesses don't match", () => {
    assert.equal(vendorNamesMatch("Nimco Foods", "Nimco Trading"), false);
    assert.equal(vendorNamesMatch("Aldi", "ALDI STORES"), false);
  });

  test("keys cover both sides of a trading name", () => {
    assert.deepEqual(vendorNameKeys("FULBECK PTY. LIMITED T/A Nimco Foods").sort(), [
      "fulbeck",
      "fulbeck t/a nimco foods",
      "nimco foods",
    ]);
  });
});

describe("abnsCompatible", () => {
  test("two different ABNs are two businesses", () => {
    assert.equal(abnsCompatible("37003900427", "90196565019"), false);
  });

  test("a missing ABN on either side leaves it to the name", () => {
    assert.equal(abnsCompatible(null, "37003900427"), true);
    assert.equal(abnsCompatible("37 003 900 427", "37003900427"), true);
  });
});

describe("vendorLabel", () => {
  test("the vendor record's name first, then what the receipt said", () => {
    assert.equal(vendorLabel("Fresh Poultry", "FRESH POULTRY PTY LTD"), "Fresh Poultry");
    assert.equal(vendorLabel(null, "Corner Shop"), "Corner Shop");
    assert.equal(vendorLabel(undefined, null), "Unrecorded vendor");
    assert.equal(vendorLabel("  ", " "), "Unrecorded vendor");
  });
});

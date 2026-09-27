import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pushTitle } from "./web-push.ts";

describe("pushTitle", () => {
  test("the system's name leads every push title", () => {
    assert.equal(pushTitle("Submitted E-0077"), "Mashk · Submitted E-0077");
  });

  test("a title that already starts with the name is left alone", () => {
    assert.equal(pushTitle("Mashk · Submitted E-0077"), "Mashk · Submitted E-0077");
  });
});

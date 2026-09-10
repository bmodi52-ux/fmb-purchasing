import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatAccount } from "./payment-instruction.ts";

/**
 * How an account reads on the screen where the transfer is made.
 *
 * Only the formatting is testable without a database — everything else in
 * payment-instruction speaks the Supabase client's query API, which the
 * in-process test Postgres cannot answer. But the formatting is the part a
 * person copies into their banking app, so a BSB that renders wrong is a
 * payment that goes somewhere else.
 */
describe("formatAccount", () => {
  test("groups a BSB the way a bank prints it", () => {
    assert.equal(formatAccount({ bsb: "082112", accountNumber: "12345678" }), "082-112 · 12345678");
  });

  test("leaves an already-punctuated BSB alone", () => {
    assert.equal(formatAccount({ bsb: "082-112", accountNumber: "12345678" }), "082-112 · 12345678");
  });

  test("says so when there is nothing to show", () => {
    assert.equal(formatAccount({ bsb: null, accountNumber: null }), "—");
  });

  test("shows half an account rather than hiding it", () => {
    // A record with one half missing is worth seeing: it is the reason the
    // transfer cannot be made, and blanking it looks like no account at all.
    assert.equal(formatAccount({ bsb: null, accountNumber: "12345678" }), "— · 12345678");
    assert.equal(formatAccount({ bsb: "082112", accountNumber: null }), "082-112 · —");
  });

  test("does not invent grouping for a BSB that is not six digits", () => {
    assert.equal(formatAccount({ bsb: "8211", accountNumber: "1" }), "8211 · 1");
  });
});

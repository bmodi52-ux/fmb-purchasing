import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { describeFailure } from "./failure-words";
import { buildTool } from "./receipt-extraction";

describe("describeFailure (#22)", () => {
  test("says what broke, not the raw error", () => {
    const raw =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Schemas contains too many parameters with union types (19 parameters with type arrays or anyOf). This causes exponential compilation cost. Reduce the number of nullable or union-typed parameters (limit: 16)."}}';
    const { title, body } = describeFailure("receipt-extraction", raw);
    assert.equal(title, "Reading a receipt failed");
    assert.match(body, /rejected the request/);
    assert.match(body, /System errors/);
    assert.ok(!body.includes("{"), "no JSON in the notice");
  });

  test("reads the common kinds of fault", () => {
    assert.match(describeFailure("email-send", "fetch failed").body, /connection/);
    assert.match(describeFailure("receipt-extraction", "429 rate_limit_error").body, /busy/);
    assert.match(describeFailure("receipt-extraction", "Request timed out.").body, /too long/);
    assert.match(describeFailure("budgets", 'duplicate key value violates unique constraint "x"').body, /database/);
  });

  test("an unknown source still reads as a sentence", () => {
    const { title, body } = describeFailure("something-new", "boom");
    assert.equal(title, "Something failed in the background");
    assert.match(body, /unexpected/);
  });
});

/**
 * The API refuses a strict tool schema with more than 16 union-typed
 * parameters, and refuses it for every receipt. Adding four fields on 21/09
 * took it to 19 and nothing was read until the next evening. This fails the
 * build instead.
 */
test("the receipt schema stays within the API's 16 union-typed parameters (#22)", () => {
  let unions = 0;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.type) && n.type.length > 1) unions++;
    if (Array.isArray(n.anyOf)) unions++;
    Object.values(n).forEach(walk);
  };
  walk(buildTool(["Meat", "Produce"]).input_schema);
  assert.ok(unions <= 16, `${unions} union-typed parameters; the API allows 16`);
});

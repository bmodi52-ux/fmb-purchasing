import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { accuracy, hasScoredFields, readingGotWorse, scoreReading, totalsOf } from "./extraction-scoring.ts";

const reading = {
  vendor: "FRESH POULTRY PTY LTD",
  abn: "65 620 358 429",
  invoiceNumber: "INV 433964",
  date: "2026-07-16",
  subtotal: 975,
  gstAmount: 0,
  total: 975.004,
  lineItems: [{}, {}],
  payee: { name: "Fresh Poultry" },
};

describe("scoreReading", () => {
  test("only the confirmed fields are scored, each by its own rule", () => {
    const { checks, passed, total } = scoreReading(reading, {
      vendor: "fresh poultry",
      abn: "65620358429",
      total: 975,
      lineCount: 3,
      notes: "never scored",
    });
    assert.equal(total, 4);
    assert.equal(passed, 3);
    assert.deepEqual(
      checks.filter((c) => !c.ok).map((c) => c.field),
      ["lineCount"]
    );
  });

  test("an entry with only notes has nothing to score", () => {
    assert.equal(hasScoredFields({ notes: "unconfirmed" }), false);
    assert.equal(hasScoredFields({ gstAmount: 0 }), true);
  });
});

describe("runs", () => {
  test("totals by field, and accuracy as a percentage", () => {
    const t = totalsOf([
      scoreReading(reading, { total: 975, vendor: "Fresh" }),
      scoreReading({ ...reading, total: 10 }, { total: 975 }),
    ]);
    assert.deepEqual(t.byField.total, { checks: 2, passed: 1 });
    assert.equal(accuracy(t), 66.7);
    assert.equal(accuracy({ checks: 0, passed: 0 }), null);
  });

  test("a drop past the margin is worse; a changed set of checks is not compared", () => {
    assert.equal(readingGotWorse({ checks: 20, passed: 17 }, { checks: 20, passed: 19 }, 5), true);
    assert.equal(readingGotWorse({ checks: 20, passed: 18 }, { checks: 20, passed: 19 }, 5), false);
    assert.equal(readingGotWorse({ checks: 25, passed: 10 }, { checks: 20, passed: 19 }, 5), false);
    assert.equal(readingGotWorse({ checks: 20, passed: 10 }, null, 5), false);
  });
});

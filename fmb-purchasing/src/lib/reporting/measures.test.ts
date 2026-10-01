import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { NOT_SPEND_STATUSES } from "@/lib/expense-status";
import { statusesFor, STATUS_BASES } from "./basis.ts";
import { MEASURES, counts, statusesOf, type Measure } from "./measures.ts";

const set = (m: Measure) => [...statusesOf(m)].sort();
const union = (...ms: Measure[]) => [...new Set(ms.flatMap((m) => [...statusesOf(m)]))].sort();
const overlap = (a: Measure, b: Measure) => statusesOf(a).filter((s) => statusesOf(b).includes(s));

describe("measures", () => {
  test("the words add up", () => {
    // spend = awaiting review + outstanding + paid, with nothing counted twice.
    assert.deepEqual(set("spend"), union("awaitingReview", "outstanding", "paid"));
    assert.deepEqual(overlap("awaitingReview", "outstanding"), []);
    assert.deepEqual(overlap("outstanding", "paid"), []);
    assert.deepEqual(overlap("awaitingReview", "paid"), []);
    // committed is spend not yet paid; accrued is spend that is approved.
    assert.deepEqual(set("committed"), union("awaitingReview", "outstanding"));
    assert.deepEqual(overlap("committed", "paid"), []);
    assert.deepEqual(set("spend"), union("committed", "paid"));
    assert.deepEqual(set("accrued"), union("outstanding", "paid"));
  });

  test("declined and withdrawn are in none of them", () => {
    for (const m of Object.keys(MEASURES) as Measure[]) {
      for (const s of NOT_SPEND_STATUSES) assert.equal(counts(m, s), false, `${m} counts ${s}`);
    }
  });

  test("what Reports can count is three of the measures, by their own statuses", () => {
    assert.deepEqual(STATUS_BASES.map((b) => b.key), ["spend", "accrued", "paid"]);
    for (const b of STATUS_BASES) assert.deepEqual(statusesFor(b.key), statusesOf(b.key));
  });

  test("every measure says what it means", () => {
    for (const m of Object.values(MEASURES)) {
      assert.ok(m.label && m.plain && m.meaning.endsWith("."));
      assert.ok(m.statuses.length > 0);
    }
  });
});

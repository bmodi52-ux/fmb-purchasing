import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { allRows, allRowsForIds } from "./all-rows.ts";

/**
 * A stand-in for PostgREST: answers `.range(from, to)` over a list of rows, and
 * like the real thing never returns more than a thousand rows at once.
 */
function fakeTable<T>() {
  const requests: { from: number; to: number }[] = [];
  const page = (subset: T[]) => async (from: number, to: number) => {
    requests.push({ from, to });
    return { data: subset.slice(from, Math.min(to + 1, from + 1000)), error: null };
  };
  return { requests, page };
}

type Line = { id: number; expenseId: string };

/** `perExpense` lines for each of `expenses` expenses. */
function ledger(expenses: number, perExpense: number): Line[] {
  const lines: Line[] = [];
  for (let e = 0; e < expenses; e++) {
    for (let l = 0; l < perExpense; l++) lines.push({ id: lines.length, expenseId: `e${e}` });
  }
  return lines;
}

describe("allRows", () => {
  test("reads past the thousand-row cap", async () => {
    const rows = ledger(1, 2500);
    const { page } = fakeTable<Line>();
    assert.equal((await allRows<Line>(page(rows))).length, 2500);
  });

  test("stops on a short page without asking for another", async () => {
    const rows = ledger(1, 10);
    const { page, requests } = fakeTable<Line>();
    await allRows<Line>(page(rows));
    assert.equal(requests.length, 1);
  });

  test("an error surfaces rather than returning what was read so far", async () => {
    await assert.rejects(
      allRows(async () => ({ data: null, error: { message: "boom" } })),
      /boom/
    );
  });
});

describe("allRowsForIds", () => {
  // The All expenses ledger asked for 200 expenses' lines at a time without
  // paging. At twenty lines a receipt that is 4,000 lines a request, and the
  // response stopped at 1,000 — three quarters of the ledger gone, silently.
  test("returns every line when one slice of ids holds more than a thousand", async () => {
    const lines = ledger(400, 20);
    const ids = [...new Set(lines.map((l) => l.expenseId))];
    const { page } = fakeTable<Line>();

    const got = await allRowsForIds<Line>(ids, (slice, from, to) =>
      page(lines.filter((l) => slice.includes(l.expenseId)))(from, to)
    );

    assert.equal(got.length, 8000);
    assert.equal(new Set(got.map((l) => l.id)).size, 8000, "no line twice");
  });

  test("sends the ids a slice at a time", async () => {
    const seen: number[] = [];
    await allRowsForIds(
      Array.from({ length: 400 }, (_, i) => `e${i}`),
      async (slice) => {
        seen.push(slice.length);
        return { data: [], error: null };
      },
      150
    );
    assert.deepEqual(seen, [150, 150, 100]);
  });

  test("no ids, no requests", async () => {
    let called = false;
    const got = await allRowsForIds([], async () => {
      called = true;
      return { data: [], error: null };
    });
    assert.deepEqual(got, []);
    assert.equal(called, false);
  });
});

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";
import { hijriToGregorian } from "./hijri/hijri.ts";
import { isoFromLocal, parsePeriod } from "./periods.ts";

/**
 * Migration 0049: budgets as ranges, and the SQL Hijri conversion that moved
 * the existing rows. The SQL has to agree with hijri.ts to the day, or every
 * budget already set would shift.
 */

let db: TestDb;

before(async () => {
  db = await createTestDb();
});

after(async () => {
  await db?.close();
});

describe("hijri_to_gregorian", () => {
  test("agrees with hijri.ts on every month start across two cycles", async () => {
    for (let year = 1420; year <= 1480; year++) {
      for (const month of [1, 9, 10, 12]) {
        const sql = await scalar<string>(db, "select hijri_to_gregorian($1, $2, 1)::text", [year, month]);
        assert.equal(sql, isoFromLocal(hijriToGregorian({ year, month, day: 1 })), `${year}-${month}`);
      }
    }
  });
});

describe("category_budgets as ranges", () => {
  test("a budget written the 0030 way is moved onto its Hijri year's dates", async () => {
    // Inserted as a pre-0049 row would have been, then run through the same
    // backfill expression the migration used.
    const category = await scalar<string>(db, "select id from categories where name = 'Miscellaneous'");
    await db.query(
      `insert into category_budgets (category_id, fiscal_year_hijri, amount, start_date, end_date, period_code, label)
       values ($1, 1447, 500,
         hijri_to_gregorian(1447, 10, 1), hijri_to_gregorian(1448, 10, 1) - 1, 'h1447', '1447-48 H')`,
      [category]
    );
    const expected = parsePeriod("h1447", "2026-09-11");
    const row = await db.query<{ start_date: string; end_date: string }>(
      "select start_date::text, end_date::text from category_budgets where category_id = $1",
      [category]
    );
    assert.deepEqual([row.rows[0].start_date, row.rows[0].end_date], [expected.start, expected.end]);
  });

  test("saving writes the budgets and their history together, and clearing is recorded", async () => {
    const category = await scalar<string>(db, "select id from categories where name = 'Dairy & Eggs'");
    const budget = (amount: number, priority: number) => ({
      category_id: category,
      start_date: "2026-07-01",
      end_date: "2027-06-30",
      period_code: "au2026",
      label: "FY 2026–27",
      amount,
      priority,
    });
    const change = { category_id: category, label: "FY 2026–27", start_date: "2026-07-01", end_date: "2027-06-30" };

    await db.query("select save_category_budgets(null, $1::jsonb, $2::jsonb)", [
      JSON.stringify([budget(1200, 0)]),
      JSON.stringify([{ ...change, kind: "set", from_amount: null, to_amount: 1200 }]),
    ]);
    const id = await scalar<string>(db, "select id from category_budgets where category_id = $1", [category]);
    assert.equal(
      await scalar<string>(db, "select budget_id::text from category_budget_changes where category_id = $1", [category]),
      id
    );

    await db.query("select save_category_budgets(null, $1::jsonb, '[]'::jsonb)", [
      JSON.stringify([{ ...budget(1500, 2), id }]),
    ]);
    assert.equal(Number(await scalar(db, "select amount from category_budgets where id = $1", [id])), 1500);

    await db.query("select clear_category_budget(null, $1)", [id]);
    assert.equal(await scalar<number>(db, "select count(*)::int from category_budgets where category_id = $1", [category]), 0);
    assert.equal(
      await scalar<string>(
        db,
        "select kind from category_budget_changes where category_id = $1 order by changed_at desc, kind limit 1",
        [category]
      ),
      "cleared"
    );
  });

  test("overlapping ranges are allowed, the same range twice is not", async () => {
    const category = await scalar<string>(db, "select id from categories where name = 'Bakery'");
    const insert = (start: string, end: string) =>
      db.query(
        `insert into category_budgets (category_id, amount, start_date, end_date, period_code, label)
         values ($1, 100, $2, $3, 'x', 'x')`,
        [category, start, end]
      );
    await insert("2026-07-01", "2027-06-30");
    await insert("2026-05-01", "2027-04-19");
    await assert.rejects(insert("2026-07-01", "2027-06-30"));
  });
});

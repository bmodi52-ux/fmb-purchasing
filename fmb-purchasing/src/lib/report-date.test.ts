import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { applyMigration, createTestDb, scalar, type TestDb } from "./test-db.ts";

/**
 * Migration 0083: the one day an expense counts on, kept in Sydney time.
 *
 * Reports, Budgets, Accounting and All expenses all find a period's expenses
 * by this column, and the lock on a lodged GST period checks it too — so it is
 * the one place the rule lives, and it is tested against Postgres itself.
 */

let db: TestDb;
let submitter: string;

before(async () => {
  db = await createTestDb();
  submitter = await addSubmitter(db, "report-date@test.local");
});

after(async () => {
  await db?.close();
});

async function addSubmitter(target: TestDb, email: string): Promise<string> {
  return scalar<string>(
    target,
    `insert into auth.users (email, raw_user_meta_data) values ($1, '{"full_name": "Dates"}'::jsonb) returning id`,
    [email]
  );
}

async function expense(
  opts: { receiptDate?: string | null; createdAt?: string },
  target: TestDb = db,
  who: string = submitter
): Promise<string> {
  return scalar<string>(
    target,
    `insert into expenses (submitted_by, vendor_name_raw, total, subtotal, status, fiscal_year_hijri, receipt_date, created_at)
     values ($1, 'Dated Vendor', 10, 10, 'submitted', 1448, $2, coalesce($3::timestamptz, now())) returning id`,
    [who, opts.receiptDate ?? null, opts.createdAt ?? null]
  );
}

const reportDate = (id: string, target: TestDb = db) =>
  scalar<string>(target, "select report_date::text from expenses where id = $1", [id]);

describe("expenses.report_date", () => {
  test("is the receipt's date when it has one", async () => {
    const id = await expense({ receiptDate: "2026-05-05", createdAt: "2026-05-09T03:00:00Z" });
    assert.equal(await reportDate(id), "2026-05-05");
  });

  test("is the day it was submitted in Sydney, not in UTC, when the receipt had none", async () => {
    // 8:30am on 1 July in Sydney (AEST, +10) is still 30 June in UTC. This
    // expense used to be June's in Reports and July's to the period lock.
    const id = await expense({ createdAt: "2026-06-30T22:30:00Z" });
    assert.equal(await reportDate(id), "2026-07-01");
  });

  test("follows daylight saving", async () => {
    // 12:30am on 1 January in Sydney is AEDT, +11.
    assert.equal(await reportDate(await expense({ createdAt: "2026-12-31T13:30:00Z" })), "2027-01-01");
    assert.equal(await reportDate(await expense({ createdAt: "2026-12-31T12:30:00Z" })), "2026-12-31");
  });

  test("does not depend on the session's time zone", async () => {
    await db.query("set timezone = 'America/Los_Angeles'");
    try {
      assert.equal(await reportDate(await expense({ createdAt: "2026-06-30T22:30:00Z" })), "2026-07-01");
    } finally {
      await db.query("set timezone = 'UTC'");
    }
  });

  test("moves when the receipt date is corrected, and falls back when it is cleared", async () => {
    const id = await expense({ receiptDate: "1994-09-11", createdAt: "2026-06-30T22:30:00Z" });
    await db.query("update expenses set receipt_date = '2026-06-28' where id = $1", [id]);
    assert.equal(await reportDate(id), "2026-06-28");
    await db.query("update expenses set receipt_date = null where id = $1", [id]);
    assert.equal(await reportDate(id), "2026-07-01");
  });

  test("can't be written to anything else", async () => {
    const id = await expense({ receiptDate: "2026-05-05" });
    await db.query("update expenses set report_date = '2020-01-01' where id = $1", [id]);
    assert.equal(await reportDate(id), "2026-05-05");
  });
});

describe("expense_in_locked_period reads the same day", () => {
  test("an undated receipt submitted on the morning of the 1st is in that month's lodged quarter", async () => {
    await db.query(
      `insert into locked_periods (start_date, end_date, label) values ('2026-07-01', '2026-09-30', 'Q1 FY27')`
    );
    const morning = await expense({ createdAt: "2026-06-30T22:30:00Z" });
    const dayBefore = await expense({ receiptDate: "2026-06-30" });

    assert.equal(await scalar<boolean>(db, "select expense_in_locked_period($1)", [morning]), true);
    assert.equal(await scalar<boolean>(db, "select expense_in_locked_period($1)", [dayBefore]), false);
  });
});

describe("the migration dates the expenses already there", () => {
  test("every existing expense gets its day, in Sydney", async () => {
    const before083 = await createTestDb({ stopBefore: "0083_expense_report_date.sql" });
    try {
      const who = await addSubmitter(before083, "before-0083@test.local");
      const insert = (receiptDate: string | null, createdAt: string) =>
        scalar<string>(
          before083,
          `insert into expenses (submitted_by, vendor_name_raw, total, subtotal, status, fiscal_year_hijri, receipt_date, created_at)
           values ($1, 'Old', 10, 10, 'paid', 1447, $2, $3) returning id`,
          [who, receiptDate, createdAt]
        );
      const dated = await insert("2026-03-03", "2026-03-10T01:00:00Z");
      const undated = await insert(null, "2026-06-30T22:30:00Z");

      await applyMigration(before083, "0083_expense_report_date.sql");

      assert.equal(await reportDate(dated, before083), "2026-03-03");
      assert.equal(await reportDate(undated, before083), "2026-07-01");
      assert.equal(
        Number(await scalar(before083, "select count(*) from expenses where report_date is null")),
        0
      );
    } finally {
      await before083.close();
    }
  });
});

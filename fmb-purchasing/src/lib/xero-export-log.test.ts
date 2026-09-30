import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";
import type { XeroBillLine } from "./xero-export.ts";
import { billHistory, billsOf, linesToExport } from "./xero-export-log.ts";

function line(expenseId: string, lineTotal: number, gst = 0): XeroBillLine {
  return {
    expenseId,
    expenseNumber: `E-${expenseId}`,
    invoiceNumber: null,
    contactName: "Vendor",
    invoiceDate: "2026-07-01",
    dueDate: "2026-07-01",
    description: "Line",
    lineTotal,
    gst,
    isCapital: false,
    accountCode: "400",
  };
}

describe("billHistory", () => {
  const lines = [line("a", 60.5, 5.5), line("a", 49.5, 4.5), line("b", 20), line("c", 33, 3)];

  test("a bill is an expense's lines added up", () => {
    assert.deepEqual(billsOf(lines), [
      { expenseId: "a", expenseNumber: "E-a", total: 110, gst: 10 },
      { expenseId: "b", expenseNumber: "E-b", total: 20, gst: 0 },
      { expenseId: "c", expenseNumber: "E-c", total: 33, gst: 3 },
    ]);
  });

  test("bills an earlier file held are sent; the latest file is the one that counts", () => {
    const h = billHistory(billsOf(lines), [
      { expenseId: "a", exportedAt: "2026-08-01T00:00:00Z", total: 100, gst: 9.09 },
      { expenseId: "a", exportedAt: "2026-09-01T00:00:00Z", total: 110, gst: 10 },
      { expenseId: "c", exportedAt: "2026-08-15T00:00:00Z", total: 33, gst: 0 },
    ]);
    assert.deepEqual(h.fresh.map((b) => b.expenseId), ["b"]);
    assert.deepEqual(
      h.sent.map((b) => [b.expenseId, b.lastExportedAt, b.changed]),
      [
        // Sent as it stands now, in the latest file: unchanged.
        ["a", "2026-09-01T00:00:00Z", false],
        // Its GST changed after it went: to correct in Xero by hand.
        ["c", "2026-08-15T00:00:00Z", true],
      ]
    );
  });

  test("new bills only leaves out every line of a sent bill", () => {
    const h = billHistory(billsOf(lines), [{ expenseId: "a", exportedAt: "2026-09-01T00:00:00Z", total: 110, gst: 10 }]);
    assert.deepEqual(linesToExport(lines, h, true).map((l) => l.expenseId), ["b", "c"]);
    assert.equal(linesToExport(lines, h, false).length, 4);
  });

  test("nothing sent before: everything is fresh", () => {
    const h = billHistory(billsOf(lines), []);
    assert.equal(h.fresh.length, 3);
    assert.equal(h.sent.length, 0);
  });
});

describe("the export log (0087)", () => {
  let db: TestDb;
  let expense = "";

  before(async () => {
    db = await createTestDb();
    const user = await scalar<string>(
      db,
      `insert into auth.users (email, raw_user_meta_data) values ('xero-log@test.local', '{"full_name": "X"}'::jsonb) returning id`
    );
    expense = await scalar<string>(
      db,
      `insert into expenses (submitted_by, vendor_name_raw, total, subtotal, status, fiscal_year_hijri)
       values ($1, 'Vendor', 110, 100, 'approved', 1448) returning id`,
      [user]
    );
  });

  after(async () => {
    await db?.close();
  });

  async function newExport(basis = "receipt"): Promise<string> {
    return scalar<string>(
      db,
      `insert into xero_exports (period_code, period_label, start_date, end_date, basis, bill_count, line_count, total, gst)
       values ('au2026-q1', 'Q1', '2026-07-01', '2026-09-30', $1, 1, 2, 110, 10) returning id`,
      [basis]
    );
  }

  test("a file and the bills in it are kept, at the totals they went at", async () => {
    const id = await newExport();
    await db.query("insert into xero_export_expenses (export_id, expense_id, total, gst) values ($1, $2, 110, 10)", [id, expense]);
    const n = await scalar<number>(db, "select count(*)::int from xero_export_expenses where expense_id = $1", [expense]);
    assert.equal(n, 1);
  });

  test("an expense is in a file once", async () => {
    const id = await newExport();
    await db.query("insert into xero_export_expenses (export_id, expense_id, total, gst) values ($1, $2, 110, 10)", [id, expense]);
    await assert.rejects(
      db.query("insert into xero_export_expenses (export_id, expense_id, total, gst) values ($1, $2, 110, 10)", [id, expense])
    );
  });

  test("the basis is receipt or paid, and removing a file removes its bills", async () => {
    await assert.rejects(newExport("cash"));
    const id = await newExport("paid");
    await db.query("insert into xero_export_expenses (export_id, expense_id, total, gst) values ($1, $2, 110, 10)", [id, expense]);
    await db.query("delete from xero_exports where id = $1", [id]);
    assert.equal(await scalar<number>(db, "select count(*)::int from xero_export_expenses where export_id = $1", [id]), 0);
  });
});

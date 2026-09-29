import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";

/** Migration 0085: what a lodged period recorded, and a payment in one held. */

let db: TestDb;
const ids = { submitter: "", approver: "", payee: "" };

before(async () => {
  db = await createTestDb();
  ids.submitter = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data) values ('lodged-s@test.local', '{"full_name": "S"}'::jsonb) returning id`
  );
  ids.approver = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data) values ('lodged-a@test.local', '{"full_name": "A"}'::jsonb) returning id`
  );
  ids.payee = await scalar<string>(db, "insert into payees (display_name) values ('Lodged Payee') returning id");
});

after(async () => {
  await db?.close();
});

async function paidExpense(receiptDate: string, paidOn: string): Promise<string> {
  const id = await scalar<string>(
    db,
    `insert into expenses (submitted_by, vendor_name_raw, total, subtotal, status, fiscal_year_hijri, payee_id, receipt_date)
     values ($1, 'Cash Vendor', 100, 100, 'approved', 1448, $2, $3) returning id`,
    [ids.submitter, ids.payee, receiptDate]
  );
  await db.query("select * from pay_expenses($1::uuid[], $2, $3::date, 'REF', null)", [[id], ids.approver, paidOn]);
  return id;
}

describe("locked_periods keeps what was lodged (0085)", () => {
  test("a lock records its basis, figures and the expenses they counted", async () => {
    const lock = await scalar<string>(
      db,
      `insert into locked_periods (start_date, end_date, label, lodged_basis, lodged_g10, lodged_g11, lodged_1b, lodged_expense_ids)
       values ('2026-01-01', '2026-03-31', 'Q3 FY26', 'receipt', 0, 160, 10, array[gen_random_uuid()]) returning id`
    );
    const row = await db.query<{ lodged_basis: string; lodged_1b: string; n: number; adj: number }>(
      `select lodged_basis, lodged_1b, cardinality(lodged_expense_ids) as n, cardinality(adjustment_expense_ids) as adj
       from locked_periods where id = $1`,
      [lock]
    );
    assert.deepEqual(row.rows[0], { lodged_basis: "receipt", lodged_1b: "10.00", n: 1, adj: 0 });
    await db.query("update locked_periods set unlocked_at = now() where id = $1", [lock]);
  });

  test("the basis can only be one of the two", async () => {
    await assert.rejects(
      db.query(
        "insert into locked_periods (start_date, end_date, label, lodged_basis) values ('2026-04-01', '2026-06-30', 'x', 'cash')"
      )
    );
  });
});

describe("reverse_payment and lodged periods (0085)", () => {
  test("a payment made inside a lodged period stays, even for a receipt dated outside it", async () => {
    // Dated in June, paid in July; July–September is lodged on the cash basis.
    const e = await paidExpense("2026-06-20", "2026-07-02");
    const lock = await scalar<string>(
      db,
      "insert into locked_periods (start_date, end_date, label, lodged_basis) values ('2026-07-01', '2026-09-30', 'Q1 FY27', 'paid') returning id"
    );
    await assert.rejects(db.query("select reverse_payment($1, $2, 'Bounced')", [e, ids.approver]), /payment was made in a period/);
    await db.query("update locked_periods set unlocked_at = now() where id = $1", [lock]);
    assert.equal(await scalar(db, "select reverse_payment($1, $2, 'Bounced')", [e, ids.approver]), true);
  });

  test("a payment outside every lodged period can still be reversed", async () => {
    const e = await paidExpense("2026-06-20", "2026-06-25");
    const lock = await scalar<string>(
      db,
      "insert into locked_periods (start_date, end_date, label) values ('2026-07-01', '2026-09-30', 'Q1 FY27') returning id"
    );
    assert.equal(await scalar(db, "select reverse_payment($1, $2, 'Wrong payee')", [e, ids.approver]), true);
    await db.query("update locked_periods set unlocked_at = now() where id = $1", [lock]);
  });
});

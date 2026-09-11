import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";

/**
 * decide_expenses, reopen_expense, pay_expenses, reverse_payment — migration
 * 0042.
 *
 * Each of these was two or three separate writes from application code, none
 * of which checked for failure. What matters here is that each is now all or
 * nothing, that the compare-and-set on status still holds, and that the
 * history row is never missing.
 */

let db: TestDb;
const ids = { submitter: "", approver: "", payee: "", otherPayee: "" };

before(async () => {
  db = await createTestDb();
  ids.submitter = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data)
     values ('submitter@test.local', '{"full_name": "Submitter"}'::jsonb) returning id`
  );
  ids.approver = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data)
     values ('approver@test.local', '{"full_name": "Approver"}'::jsonb) returning id`
  );
  ids.payee = await scalar<string>(db, "insert into payees (display_name) values ('Payee One') returning id");
  ids.otherPayee = await scalar<string>(db, "insert into payees (display_name) values ('Payee Two') returning id");
});

after(async () => {
  await db?.close();
});

async function newExpense(status = "submitted", payee: string | null = null): Promise<string> {
  return scalar<string>(
    db,
    `insert into expenses (submitted_by, vendor_name_raw, total, subtotal, status, fiscal_year_hijri, payee_id)
     values ($1, 'Lifecycle Vendor', 100, 100, $2::expense_status, 1448, $3) returning id`,
    [ids.submitter, status, payee]
  );
}

async function history(expenseId: string) {
  const result = await db.query<{ from_status: string | null; to_status: string; comment: string | null; is_reversal: boolean }>(
    "select from_status, to_status, comment, is_reversal from expense_status_history where expense_id = $1 order by created_at",
    [expenseId]
  );
  return result.rows;
}

describe("decide_expenses", () => {
  test("approves submitted expenses, records history, and returns what it decided", async () => {
    const a = await newExpense();
    const b = await newExpense();
    const result = await db.query<{ id: string }>(
      "select * from decide_expenses($1::uuid[], $2, 'approved', 'Looks right')",
      [[a, b], ids.approver]
    );
    assert.equal(result.rows.length, 2);
    assert.equal(await scalar(db, "select status::text from expenses where id = $1", [a]), "approved");
    assert.equal(await scalar(db, "select decided_by from expenses where id = $1", [a]), ids.approver);
    assert.deepEqual(
      (await history(a)).map((h) => [h.from_status, h.to_status, h.comment]),
      [["submitted", "approved", "Looks right"]]
    );
  });

  test("leaves an expense someone else already decided alone", async () => {
    const already = await newExpense("declined");
    const result = await db.query("select * from decide_expenses($1::uuid[], $2, 'approved', null)", [
      [already],
      ids.approver,
    ]);
    assert.equal(result.rows.length, 0);
    assert.equal(await scalar(db, "select status::text from expenses where id = $1", [already]), "declined");
    assert.equal((await history(already)).length, 0);
  });

  test("refuses a decision that is not approve or decline, changing nothing", async () => {
    const e = await newExpense();
    await assert.rejects(
      db.query("select * from decide_expenses($1::uuid[], $2, 'paid', null)", [[e], ids.approver])
    );
    assert.equal(await scalar(db, "select status::text from expenses where id = $1", [e]), "submitted");
  });
});

describe("reopen_expense", () => {
  test("returns an approved expense to submitted, as a reversal with its reason", async () => {
    const e = await newExpense("approved");
    assert.equal(await scalar(db, "select reopen_expense($1, $2, 'Wrong vendor')", [e, ids.approver]), true);
    assert.equal(await scalar(db, "select status::text from expenses where id = $1", [e]), "submitted");
    const [row] = await history(e);
    assert.equal(row.is_reversal, true);
    assert.equal(row.comment, "Wrong vendor");
  });

  test("will not reopen a paid expense, and needs a reason", async () => {
    const paid = await newExpense("paid");
    assert.equal(await scalar(db, "select reopen_expense($1, $2, 'x')", [paid, ids.approver]), false);
    const approved = await newExpense("approved");
    await assert.rejects(db.query("select reopen_expense($1, $2, '  ')", [approved, ids.approver]));
    assert.equal(await scalar(db, "select status::text from expenses where id = $1", [approved]), "approved");
  });
});

describe("pay_expenses", () => {
  test("one payee: one run, every expense stamped from it, history for each", async () => {
    const a = await newExpense("approved", ids.payee);
    const b = await newExpense("approved", ids.payee);
    const result = await db.query<{ run_id: string | null; id: string }>(
      "select * from pay_expenses($1::uuid[], $2, '2026-09-01', 'REF-9', null)",
      [[a, b], ids.approver]
    );
    assert.equal(result.rows.length, 2);
    const runId = result.rows[0].run_id;
    assert.ok(runId);
    assert.equal(await scalar(db, "select count(*)::int from expenses where payment_run_id = $1", [runId]), 2);
    assert.equal(await scalar(db, "select payment_reference from expenses where id = $1", [b]), "REF-9");
    assert.deepEqual(
      (await history(a)).map((h) => [h.to_status, h.comment]),
      [["paid", "Payment reference: REF-9"]]
    );
  });

  test("several payees: paid, but no run", async () => {
    const a = await newExpense("approved", ids.payee);
    const b = await newExpense("approved", ids.otherPayee);
    const result = await db.query<{ run_id: string | null }>(
      "select * from pay_expenses($1::uuid[], $2, '2026-09-01', null, null)",
      [[a, b], ids.approver]
    );
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].run_id, null);
  });

  test("nothing payable: no run is created", async () => {
    const before = await scalar<number>(db, "select count(*)::int from payment_runs");
    const submitted = await newExpense("submitted", ids.payee);
    const result = await db.query("select * from pay_expenses($1::uuid[], $2, '2026-09-01', null, null)", [
      [submitted],
      ids.approver,
    ]);
    assert.equal(result.rows.length, 0);
    assert.equal(await scalar<number>(db, "select count(*)::int from payment_runs"), before);
  });
});

describe("reverse_payment", () => {
  test("returns the expense to approved and removes a run that no longer covers anything", async () => {
    const e = await newExpense("approved", ids.payee);
    const paid = await db.query<{ run_id: string }>(
      "select * from pay_expenses($1::uuid[], $2, '2026-09-02', 'REF-X', null)",
      [[e], ids.approver]
    );
    const runId = paid.rows[0].run_id;

    assert.equal(await scalar(db, "select reverse_payment($1, $2, 'Transfer bounced')", [e, ids.approver]), true);
    assert.equal(await scalar(db, "select status::text from expenses where id = $1", [e]), "approved");
    assert.equal(await scalar<number>(db, "select count(*)::int from payment_runs where id = $1", [runId]), 0);
    const last = (await history(e)).at(-1)!;
    assert.equal(last.is_reversal, true);
    assert.equal(last.comment, "Transfer bounced");
  });

  test("keeps a run that still covers other expenses", async () => {
    const a = await newExpense("approved", ids.payee);
    const b = await newExpense("approved", ids.payee);
    const paid = await db.query<{ run_id: string }>(
      "select * from pay_expenses($1::uuid[], $2, '2026-09-03', null, null)",
      [[a, b], ids.approver]
    );
    await db.query("select reverse_payment($1, $2, 'Only one was paid')", [a, ids.approver]);
    assert.equal(
      await scalar<number>(db, "select count(*)::int from payment_runs where id = $1", [paid.rows[0].run_id]),
      1
    );
  });
});

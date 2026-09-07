import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type TestDb } from "./test-db.ts";

/**
 * What migration 0037 changed about a vendor's bank account.
 *
 * 0027 gave every vendor exactly one payee row and let nothing add a second,
 * which stopped a submitter silently replacing an account the Treasurer set
 * up — and also left nowhere to record that a supplier had changed banks. The
 * account is now a row with a life of its own: pending, approved, superseded.
 *
 * Against the real schema in PGlite rather than mocks, because every rule here
 * is enforced by an index or a check constraint.
 */

async function aVendor(db: TestDb, name: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into vendors (name, status) values ($1, 'approved') returning id`,
    [name]
  );
  return r.rows[0]!.id;
}

async function anAccount(
  db: TestDb,
  vendorId: string,
  bsb: string,
  status: "pending" | "approved" = "approved"
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into payees (display_name, vendor_id, bank_bsb, bank_account_number, status)
     values ('Taj Mart', $1, $2, '971464641', $3) returning id`,
    [vendorId, bsb, status]
  );
  return r.rows[0]!.id;
}

describe("0037 — a vendor's account can change without losing the old one", () => {
  test("refuses a second approved account for one vendor", async () => {
    // What everything resolving "the vendor's account" still relies on.
    const db = await createTestDb();
    const vendor = await aVendor(db, "Taj Mart");
    await anAccount(db, vendor, "082112");

    await assert.rejects(() => anAccount(db, vendor, "013006"), /duplicate key|unique/i);
    await db.close();
  });

  test("allows proposals to sit beside the approved account", async () => {
    const db = await createTestDb();
    const vendor = await aVendor(db, "Taj Mart");
    await anAccount(db, vendor, "082112");
    await anAccount(db, vendor, "013006", "pending");
    await anAccount(db, vendor, "062000", "pending");

    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from payees where vendor_id = $1 and status = 'pending'`,
      [vendor]
    );
    assert.equal(r.rows[0]!.n, 2, "two invoices can disagree with the file, and each is kept");
    await db.close();
  });

  test("lets a superseded account share a vendor with the account that replaced it", async () => {
    const db = await createTestDb();
    const vendor = await aVendor(db, "Taj Mart");
    const old = await anAccount(db, vendor, "082112");

    await db.query(
      `update payees set status = 'superseded', superseded_at = now() where id = $1`,
      [old]
    );
    const replacement = await anAccount(db, vendor, "013006");
    await db.query(`update payees set superseded_by = $1 where id = $2`, [replacement, old]);

    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from payees where vendor_id = $1`,
      [vendor]
    );
    assert.equal(r.rows[0]!.n, 2, "the history is kept, not overwritten");
    await db.close();
  });

  test("a superseded account must say when it stopped being current", async () => {
    const db = await createTestDb();
    const vendor = await aVendor(db, "Taj Mart");
    const account = await anAccount(db, vendor, "082112");

    await assert.rejects(
      () => db.query(`update payees set status = 'superseded' where id = $1`, [account]),
      /payees_superseded_consistent/,
      "'used until —' is not a useful thing for the vendor page to show"
    );
    await db.close();
  });

  test("an account still in use cannot carry a superseded date", async () => {
    const db = await createTestDb();
    const vendor = await aVendor(db, "Taj Mart");
    const account = await anAccount(db, vendor, "082112");

    await assert.rejects(
      () => db.query(`update payees set superseded_at = now() where id = $1`, [account]),
      /payees_superseded_consistent/
    );
    await db.close();
  });

  test("refuses a status nobody has defined", async () => {
    const db = await createTestDb();
    const vendor = await aVendor(db, "Taj Mart");

    await assert.rejects(
      () =>
        db.query(
          `insert into payees (display_name, vendor_id, status) values ('Taj Mart', $1, 'archived')`,
          [vendor]
        ),
      /payees_status_check/
    );
    await db.close();
  });

  test("leaves members and outside payees alone", async () => {
    // A person has one payee record, as before — the new index is only about
    // vendors, and two people with no vendor link are not a collision.
    const db = await createTestDb();
    await db.query(`insert into payees (display_name) values ('Ali Abbas Amir')`);
    await db.query(`insert into payees (display_name) values ('Huzaifa Bhai')`);

    const r = await db.query<{ n: number }>(
      `select count(*)::int as n from payees where vendor_id is null`
    );
    assert.equal(r.rows[0]!.n, 2);
    await db.close();
  });

  test("defaults an account to the one in use", async () => {
    // Every row written before 0037 was the account in use, and every row the
    // Treasurer writes after it is too.
    const db = await createTestDb();
    const vendor = await aVendor(db, "Taj Mart");
    await db.query(
      `insert into payees (display_name, vendor_id, bank_bsb) values ('Taj Mart', $1, '082112')`,
      [vendor]
    );

    const r = await db.query<{ status: string }>(
      `select status from payees where vendor_id = $1`,
      [vendor]
    );
    assert.equal(r.rows[0]!.status, "approved");
    await db.close();
  });

  test("keeps an expense pointing at the account it was paid to", async () => {
    // The whole reason nothing is overwritten: "which account did that
    // $5,065.76 go to" has to stay answerable after the vendor changes banks.
    const db = await createTestDb();
    const vendor = await aVendor(db, "Taj Mart");
    const old = await anAccount(db, vendor, "082112");

    const submitter = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values ('treasurer@test.local', '{"full_name": "Payee Account Test"}'::jsonb) returning id`
    );
    const expense = await db.query<{ id: string }>(
      `insert into expenses (vendor_id, total, payee_id, fiscal_year_hijri, submitted_by)
       values ($1, 5065.76, $2, 1447, $3) returning id`,
      [vendor, old, submitter.rows[0]!.id]
    );

    await db.query(
      `update payees set status = 'superseded', superseded_at = now() where id = $1`,
      [old]
    );
    await anAccount(db, vendor, "013006");

    const r = await db.query<{ bank_bsb: string }>(
      `select p.bank_bsb from expenses e join payees p on p.id = e.payee_id where e.id = $1`,
      [expense.rows[0]!.id]
    );
    assert.equal(r.rows[0]!.bank_bsb, "082112", "paid into the account of the time");
    await db.close();
  });
});

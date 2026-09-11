import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";

/** Migration 0055: receipts kept five years, and the backup record. */

let db: TestDb;
let submitter: string;

before(async () => {
  db = await createTestDb();
  submitter = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data) values ('records@test.local', '{"full_name": "Records"}'::jsonb) returning id`
  );
});

after(async () => {
  await db?.close();
});

async function expenseWithReceipt(status: string, createdAt = "now()"): Promise<string> {
  const id = await scalar<string>(
    db,
    `insert into expenses (submitted_by, vendor_name_raw, total, subtotal, status, fiscal_year_hijri, created_at)
     values ($1, 'Kept Vendor', 10, 10, $2::expense_status, 1448, ${createdAt}) returning id`,
    [submitter, status]
  );
  await db.query(
    `insert into expense_attachments (expense_id, storage_path, file_name, content_type)
     values ($1, 'sha256/aa/receipt.jpg', 'receipt.jpg', 'image/jpeg')`,
    [id]
  );
  return id;
}

describe("receipts are kept for five years", () => {
  test("a decided expense's receipt can't be removed", async () => {
    const id = await expenseWithReceipt("approved");
    await assert.rejects(db.query("delete from expense_attachments where expense_id = $1", [id]), /five years/);
  });

  test("a waiting expense's submitter can still swap a wrong file", async () => {
    const id = await expenseWithReceipt("submitted");
    await db.query("delete from expense_attachments where expense_id = $1", [id]);
    assert.equal(Number(await scalar(db, "select count(*) from expense_attachments where expense_id = $1", [id])), 0);
  });

  test("an expense carrying receipts can't be deleted, even while waiting", async () => {
    const id = await expenseWithReceipt("submitted");
    await assert.rejects(db.query("delete from expenses where id = $1", [id]), /five years/);
  });

  test("after five years, it can", async () => {
    const id = await expenseWithReceipt("paid", "now() - interval '6 years'");
    await db.query("delete from expenses where id = $1", [id]);
    assert.equal(Number(await scalar(db, "select count(*) from expenses where id = $1", [id])), 0);
  });

  test("an expense without receipts is not held", async () => {
    const id = await scalar<string>(
      db,
      `insert into expenses (submitted_by, vendor_name_raw, total, subtotal, status, fiscal_year_hijri)
       values ($1, 'No Receipt', 10, 10, 'submitted', 1448) returning id`,
      [submitter]
    );
    await db.query("delete from expenses where id = $1", [id]);
  });
});

describe("records", () => {
  test("the backup script can list every table", async () => {
    const names = (await db.query<{ name: string }>("select public_table_names() as name")).rows.map((r) => r.name);
    for (const table of ["expenses", "vendor_changes", "backup_runs", "restore_rehearsals"]) {
      assert.ok(names.includes(table), table);
    }
  });

  test("vendor history takes only the kinds the app writes", async () => {
    const vendor = await scalar<string>(db, "insert into vendors (name) values ('History Vendor') returning id");
    await db.query("insert into vendor_changes (vendor_id, changed_by, kind) values ($1, $2, 'created')", [vendor, submitter]);
    await assert.rejects(db.query("insert into vendor_changes (vendor_id, kind) values ($1, 'renamed')", [vendor]));
  });
});

describe("what is overdue", () => {
  test("backups older than a week and rehearsals older than six months", async () => {
    const { recordsAttention } = await import("./records.ts");
    const now = new Date("2026-09-12T00:00:00Z");
    assert.deepEqual(
      recordsAttention({ lastDatabaseBackup: "2026-09-10T00:00:00Z", lastReceiptBackup: null, lastRehearsal: "2026-01-01" }, now),
      ["No receipt file backup has been recorded.", "The last restore rehearsal was 8 months ago."]
    );
    assert.deepEqual(
      recordsAttention(
        { lastDatabaseBackup: "2026-09-01T00:00:00Z", lastReceiptBackup: "2026-09-11T00:00:00Z", lastRehearsal: "2026-08-01" },
        now
      ),
      ["The last database backup was 11 days ago."]
    );
  });
});

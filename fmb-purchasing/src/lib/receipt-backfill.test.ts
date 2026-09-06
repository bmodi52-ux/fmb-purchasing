import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

/**
 * Migration 0033, which drops expenses.receipt_file_path.
 *
 * The risk it carries is specific and one-way. Dropping the column removes the
 * only reference to objects sitting in the receipts bucket, so a receipt that
 * did not make it into expense_attachments first becomes unreachable — the
 * file is still there, costing money, with nothing in the database that knows
 * its name or which expense it belonged to.
 *
 * 0028's backfill is not enough on its own, because the application and the
 * database are not upgraded together: production kept running the previous
 * release after 0028 landed, and that release writes receipt_file_path and
 * knows nothing about expense_attachments. So 0033 backfills again and then
 * refuses to drop anything it could not account for.
 *
 * These tests build the migration sequence by hand rather than using
 * createTestDb, because the whole point is what happens to rows written
 * *between* 0028 and 0033 — which a database with every migration already
 * applied cannot express.
 */

const MIGRATIONS = path.join(import.meta.dirname, "..", "..", "supabase", "migrations");

const AUTH_STUB = `
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique, encrypted_password text, email_confirmed_at timestamptz,
    raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz not null default now()
  );
`;

function migrationsUpTo(last: string): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f.slice(0, 4) <= last)
    .sort();
}

/** A database with everything up to and including 0032 — the state before the drop. */
async function dbBefore0033(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(AUTH_STUB);
  for (const f of migrationsUpTo("0032")) {
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  return db;
}

const MIGRATION_0033 = readFileSync(path.join(MIGRATIONS, "0033_drop_receipt_file_path.sql"), "utf8");

let profileId: string;

async function seedExpense(db: PGlite, receiptPath: string | null): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into expenses (submitted_by, vendor_name_raw, total, fiscal_year_hijri, receipt_file_path)
     values ($1, 'Test Vendor', 100, 1448, $2) returning id`,
    [profileId, receiptPath]
  );
  return r.rows[0]!.id;
}

async function setup(db: PGlite) {
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data)
     values ($1, '{"full_name": "Backfill Test"}'::jsonb) returning id`,
    [`backfill${Math.random()}@test.local`]
  );
  profileId = r.rows[0]!.id;
}

describe("0033 — dropping receipt_file_path", () => {
  test("carries across a receipt written after 0028 ran", async () => {
    const db = await dbBefore0033();
    await setup(db);
    // The window that matters: the old release wrote this after 0028's
    // backfill had already been and gone.
    const id = await seedExpense(db, "abc/123-late-receipt.jpg");

    await db.exec(MIGRATION_0033);

    const a = await db.query<{ storage_path: string; file_name: string; content_type: string }>(
      "select storage_path, file_name, content_type from expense_attachments where expense_id = $1",
      [id]
    );
    assert.equal(a.rows.length, 1);
    assert.equal(a.rows[0]!.storage_path, "abc/123-late-receipt.jpg");
    // The original filename is recovered from the tail of the key.
    assert.equal(a.rows[0]!.file_name, "late-receipt.jpg");
    assert.equal(a.rows[0]!.content_type, "image/jpeg");
    await db.close();
  });

  test("infers the content type from the extension", async () => {
    const db = await dbBefore0033();
    await setup(db);
    const pdf = await seedExpense(db, "u/1-invoice.pdf");
    const png = await seedExpense(db, "u/2-shot.png");
    const webp = await seedExpense(db, "u/3-photo.webp");

    await db.exec(MIGRATION_0033);

    const types = await db.query<{ expense_id: string; content_type: string }>(
      "select expense_id, content_type from expense_attachments"
    );
    const by = new Map(types.rows.map((r) => [r.expense_id, r.content_type]));
    assert.equal(by.get(pdf), "application/pdf");
    assert.equal(by.get(png), "image/png");
    assert.equal(by.get(webp), "image/webp");
    await db.close();
  });

  test("does not duplicate a receipt 0028 already carried across", async () => {
    const db = await dbBefore0033();
    await setup(db);
    const id = await seedExpense(db, "u/1-already.jpg");
    // Exactly what 0028's backfill would have left behind.
    await db.query(
      `insert into expense_attachments (expense_id, storage_path, file_name, content_type)
       values ($1, 'u/1-already.jpg', 'already.jpg', 'image/jpeg')`,
      [id]
    );

    await db.exec(MIGRATION_0033);

    const n = await db.query<{ n: number }>(
      "select count(*)::int as n from expense_attachments where expense_id = $1",
      [id]
    );
    assert.equal(n.rows[0]!.n, 1);
    await db.close();
  });

  test("keeps other attachments an edit added alongside the original", async () => {
    const db = await dbBefore0033();
    await setup(db);
    const id = await seedExpense(db, "u/1-original.jpg");
    // An expense edited under the new release: it gained a delivery docket
    // while still carrying its original path. Matching on "has any
    // attachment" would have lost the original here.
    await db.query(
      `insert into expense_attachments (expense_id, storage_path, file_name, content_type)
       values ($1, 'sha256/aa/aaa.pdf', 'docket.pdf', 'application/pdf')`,
      [id]
    );

    await db.exec(MIGRATION_0033);

    const paths = await db.query<{ storage_path: string }>(
      "select storage_path from expense_attachments where expense_id = $1 order by storage_path",
      [id]
    );
    assert.deepEqual(
      paths.rows.map((r) => r.storage_path),
      ["sha256/aa/aaa.pdf", "u/1-original.jpg"]
    );
    await db.close();
  });

  test("leaves an expense with no receipt alone", async () => {
    const db = await dbBefore0033();
    await setup(db);
    const id = await seedExpense(db, null);

    await db.exec(MIGRATION_0033);

    const n = await db.query<{ n: number }>(
      "select count(*)::int as n from expense_attachments where expense_id = $1",
      [id]
    );
    assert.equal(n.rows[0]!.n, 0);
    await db.close();
  });

  test("the column is gone afterwards", async () => {
    const db = await dbBefore0033();
    await setup(db);
    await db.exec(MIGRATION_0033);

    const n = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
       where table_name = 'expenses' and column_name = 'receipt_file_path'`
    );
    assert.equal(n.rows[0]!.n, 0);
    await db.close();
  });

  test("refuses to drop when a receipt could not be carried across", async () => {
    const db = await dbBefore0033();
    await setup(db);
    await seedExpense(db, "u/1-unreachable.jpg");

    // Simulate the backfill being unable to do its job — here by removing the
    // insert's target so nothing lands. The guard is what must fire.
    await db.exec(`
      create rule skip_backfill as on insert to expense_attachments do instead nothing;
    `);

    await assert.rejects(
      () => db.exec(MIGRATION_0033),
      /Refusing to drop receipt_file_path: 1 receipt/
    );

    // And having refused, the column is still there — the receipt is still
    // reachable rather than orphaned in storage.
    const n = await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
       where table_name = 'expenses' and column_name = 'receipt_file_path'`
    );
    assert.equal(n.rows[0]!.n, 1);
    await db.close();
  });
});

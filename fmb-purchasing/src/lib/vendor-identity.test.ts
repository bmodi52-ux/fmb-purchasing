import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { preferredVendor } from "./expense-matching";

/**
 * Migrations 0034 and 0035, which collapse duplicate vendors and duplicate
 * vendor payees.
 *
 * The bug they close was self-feeding. matchOrCreateVendor looked a vendor up
 * with .maybeSingle(), which fails outright on more than one row, and the
 * caller discarded the failure — so the moment a vendor existed twice, every
 * later receipt from that vendor matched nothing and inserted another copy. A
 * submitter would approve a vendor, upload the next receipt from the same
 * shop, and be shown a form that looked as though it had never heard of it.
 *
 * Built from the migration sequence by hand rather than from createTestDb,
 * because what is under test is what happens to rows written *before* 0034 —
 * which a database that already has 0034 applied cannot express.
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

async function dbUpTo(last: string): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(AUTH_STUB);
  for (const f of migrationsUpTo(last)) {
    await db.exec(readFileSync(path.join(MIGRATIONS, f), "utf8"));
  }
  return db;
}

function migration(name: string): string {
  return readFileSync(path.join(MIGRATIONS, name), "utf8");
}

const M0034 = migration("0034_vendor_identity.sql");

async function aProfile(db: PGlite): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data)
     values ($1, '{"full_name": "Vendor Identity Test"}'::jsonb) returning id`,
    [`vendors${Math.random()}@test.local`]
  );
  return r.rows[0]!.id;
}

async function aVendor(
  db: PGlite,
  name: string,
  abn: string | null,
  status: "pending" | "approved" = "pending"
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into vendors (name, abn, status) values ($1, $2, $3) returning id`,
    [name, abn, status]
  );
  return r.rows[0]!.id;
}

async function vendorIds(db: PGlite): Promise<string[]> {
  const r = await db.query<{ id: string }>("select id from vendors");
  return r.rows.map((row) => row.id);
}

async function count(db: PGlite, sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query<{ n: number }>(sql, params);
  return r.rows[0]!.n;
}

describe("0034 — collapsing duplicate vendors", () => {
  test("merges two vendors sharing an ABN, keeping the reviewed one", async () => {
    const db = await dbUpTo("0033");
    const pending = await aVendor(db, "Foodworks Guildford", "37129853041");
    const approved = await aVendor(db, "FOODWORKS GUILDFORD", "37129853041", "approved");

    await db.exec(M0034);

    const left = await vendorIds(db);
    assert.deepEqual(left, [approved], "the reviewed vendor is the one that survives");
    assert.ok(!left.includes(pending));
    await db.close();
  });

  test("carries the losing vendor's expenses across", async () => {
    const db = await dbUpTo("0033");
    const profile = await aProfile(db);
    const loser = await aVendor(db, "Taj Mart", "11111111111");
    const winner = await aVendor(db, "Taj Mart", "11111111111", "approved");
    const r = await db.query<{ id: string }>(
      `insert into expenses (submitted_by, vendor_id, total, fiscal_year_hijri)
       values ($1, $2, 100, 1448) returning id`,
      [profile, loser]
    );

    await db.exec(M0034);

    const after = await db.query<{ vendor_id: string }>(
      "select vendor_id from expenses where id = $1",
      [r.rows[0]!.id]
    );
    assert.equal(after.rows[0]!.vendor_id, winner, "no expense is orphaned by the merge");
    await db.close();
  });

  test("merges by name when neither copy has an ABN", async () => {
    const db = await dbUpTo("0033");
    await aVendor(db, "Radhe Groceries", null);
    await aVendor(db, "  radhe groceries ", null);

    await db.exec(M0034);

    assert.equal(
      await count(db, "select count(*)::int as n from vendors"),
      1,
      "case and stray whitespace are not different vendors"
    );
    await db.close();
  });

  test("leaves genuinely different vendors alone", async () => {
    const db = await dbUpTo("0033");
    await aVendor(db, "Foodworks Guildford", "37129853041");
    await aVendor(db, "Foodworks Merrylands", "99999999999");

    await db.exec(M0034);

    assert.equal(await count(db, "select count(*)::int as n from vendors"), 2);
    await db.close();
  });

  test("normalises an ABN stored in the form printed on a tax invoice", async () => {
    const db = await dbUpTo("0033");
    await aVendor(db, "Spaced Out Supplies", "37 129 853 041");

    await db.exec(M0034);

    const r = await db.query<{ abn: string }>("select abn from vendors");
    assert.equal(r.rows[0]!.abn, "37129853041", "otherwise no equality check can ever match it");
    await db.close();
  });

  test("the same ABN cannot be recorded twice afterwards", async () => {
    const db = await dbUpTo("0033");
    await db.exec(M0034);
    await aVendor(db, "First", "37129853041");

    await assert.rejects(
      () => aVendor(db, "Second", "37129853041"),
      /duplicate key|unique/i,
      "the index is what stops the fault re-establishing itself"
    );
    await db.close();
  });

  test("vendors without an ABN are still allowed alongside each other", async () => {
    const db = await dbUpTo("0033");
    await db.exec(M0034);
    await aVendor(db, "One", null);
    await aVendor(db, "Two", null);

    assert.equal(
      await count(db, "select count(*)::int as n from vendors"),
      2,
      "a partial index must not treat nulls as a collision"
    );
    await db.close();
  });
});

/**
 * payeeForVendor reads a vendor's payee back with .limit(1) and treats it as
 * *the* row. That is only sound because 0027 made it so, and this is the
 * assumption written down where a future migration touching payees will trip
 * over it.
 */
describe("one payee per vendor (0027's guarantee, which payeeForVendor relies on)", () => {
  test("a second payee for the same vendor is refused", async () => {
    const db = await dbUpTo("0034");
    const vendor = await aVendor(db, "Taj Mart", null);
    await db.query(`insert into payees (display_name, vendor_id) values ('Taj Mart', $1)`, [vendor]);

    await assert.rejects(
      () =>
        db.query(`insert into payees (display_name, vendor_id) values ('Taj Mart', $1)`, [vendor]),
      /duplicate key|unique/i
    );
    await db.close();
  });

  test("members and outside payees are untouched by that index", async () => {
    const db = await dbUpTo("0034");
    await db.query(`insert into payees (display_name) values ('Ali Abbas Amir')`);
    await db.query(`insert into payees (display_name) values ('Huzaifa Bhai')`);

    assert.equal(
      await count(db, "select count(*)::int as n from payees where vendor_id is null"),
      2,
      "a partial index must not treat nulls as a collision"
    );
    await db.close();
  });
});

describe("preferredVendor", () => {
  test("prefers a reviewed vendor over a provisional one", () => {
    const picked = preferredVendor([
      { id: "b", status: "pending", created_at: "2026-01-01" },
      { id: "a", status: "approved", created_at: "2026-06-01" },
    ]);
    assert.equal(picked?.id, "a", "somebody looked at it, and its number is on paperwork");
  });

  test("falls back to the oldest, then to the lowest id", () => {
    assert.equal(
      preferredVendor([
        { id: "b", status: "pending", created_at: "2026-06-01" },
        { id: "a", status: "pending", created_at: "2026-01-01" },
      ])?.id,
      "a"
    );
    assert.equal(
      preferredVendor([
        { id: "b", status: "pending", created_at: "2026-01-01" },
        { id: "a", status: "pending", created_at: "2026-01-01" },
      ])?.id,
      "a",
      "identical timestamps must still give a stable answer"
    );
  });

  test("returns null rather than throwing when nothing matched", () => {
    assert.equal(preferredVendor([]), null);
  });

  test("does not reorder the caller's array", () => {
    const rows = [
      { id: "b", status: "pending", created_at: "2026-06-01" },
      { id: "a", status: "approved", created_at: "2026-01-01" },
    ];
    preferredVendor(rows);
    assert.equal(rows[0]!.id, "b", "sorting props in place is how a table starts flickering");
  });
});

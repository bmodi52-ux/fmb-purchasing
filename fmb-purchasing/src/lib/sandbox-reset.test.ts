import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";

/**
 * Migrations 0058 and 0059: emptying the sandbox, and leaving its numbering
 * somewhere a new expense can continue from.
 */

let db: TestDb;

before(async () => {
  db = await createTestDb();
});

after(async () => {
  await db?.close();
});

describe("the guard", () => {
  test("both functions refuse while the database says it is live", async () => {
    assert.equal(await scalar(db, "select kind from deployment_kind"), "live");
    await assert.rejects(db.query("select sandbox_reset()"), /marked live/);
    await assert.rejects(db.query("select sandbox_sync_sequences()"), /marked live/);
  });
});

describe("once it is marked as the sandbox", () => {
  before(async () => {
    await db.query("update deployment_kind set kind = 'sandbox'");
  });

  /** A reset empties the units and categories too, so put back what a test needs. */
  async function unitAndCategory(): Promise<{ unit: string; category: string }> {
    const unit =
      (await db.query<{ id: string }>("select id from units where code = 'kg'")).rows[0]?.id ??
      (await db.query<{ id: string }>(
        "insert into units (code, label, base_unit_code) values ('kg', 'kg', 'kg') returning id"
      )).rows[0].id;
    const category =
      (await db.query<{ id: string }>("select id from categories limit 1")).rows[0]?.id ??
      (await db.query<{ id: string }>("insert into categories (name) values ('Sandbox') returning id")).rows[0].id;
    return { unit, category };
  }

  test("a reset empties the data and keeps the registry", async () => {
    await db.query("insert into vendors (name, status) values ('Doomed Vendor', 'approved')");
    await db.query("select sandbox_reset()");
    assert.equal(Number(await scalar(db, "select count(*) from vendors")), 0);
    assert.ok(Number(await scalar(db, "select count(*) from app_pages")) > 0, "the page registry survives");
    assert.ok(Number(await scalar(db, "select count(*) from schema_migrations")) > 0, "the ledger survives");
  });

  test("numbering carries on after a sync, rather than repeating itself", async () => {
    const { unit, category } = await unitAndCategory();
    // The seed lets the sandbox assign its own numbers: item_seq is GENERATED
    // ALWAYS, so a copied value would be refused (see withoutGeneratedColumns).
    const first = await db.query<{ item_seq: number }>(
      "insert into items (name, canonical_unit_id, category_id) values ('Seeded', $1, $2) returning item_seq",
      [unit, category]
    );
    await db.query("select sandbox_sync_sequences()");
    const second = await db.query<{ item_seq: number }>(
      "insert into items (name, canonical_unit_id, category_id) values ('After sync', $1, $2) returning item_seq",
      [unit, category]
    );
    assert.equal(Number(second.rows[0].item_seq), Number(first.rows[0].item_seq) + 1);
  });

  test("syncing twice changes nothing", async () => {
    await db.query("select sandbox_sync_sequences()");
    await db.query("select sandbox_sync_sequences()");
    const { unit, category } = await unitAndCategory();
    const highest = Number(await scalar(db, "select coalesce(max(item_seq), 0) from items"));
    const next = await db.query<{ item_seq: number }>(
      "insert into items (name, canonical_unit_id, category_id) values ('Another', $1, $2) returning item_seq",
      [unit, category]
    );
    assert.equal(Number(next.rows[0].item_seq), highest + 1);
  });

  test("an empty table starts again at one", async () => {
    await db.query("select sandbox_reset()");
    await db.query("select sandbox_sync_sequences()");
    const { unit, category } = await unitAndCategory();
    const first = await db.query<{ item_seq: number }>(
      "insert into items (name, canonical_unit_id, category_id) values ('First', $1, $2) returning item_seq",
      [unit, category]
    );
    assert.equal(Number(first.rows[0].item_seq), 1);
  });
});

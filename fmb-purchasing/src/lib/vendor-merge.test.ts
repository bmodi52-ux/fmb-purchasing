import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";

/**
 * Migration 0080 (#44): merging two vendors, and undoing it.
 */

let db: TestDb;
const ids = { profile: "", category: "", kg: "" };
let seq = 0;

before(async () => {
  db = await createTestDb();
  ids.profile = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data)
     values ('merge@test.local', '{"full_name": "Merge Test"}'::jsonb) returning id`
  );
  ids.category = await scalar<string>(db, "select id from categories where name = 'Miscellaneous'");
  ids.kg = await scalar<string>(db, "select id from units where code = 'kg'");
});

after(async () => {
  await db?.close();
});

async function vendor(name: string, abn: string | null, createdAt: string): Promise<string> {
  return scalar<string>(
    db,
    "insert into vendors (name, abn, status, created_at) values ($1, $2, 'approved', $3) returning id",
    [name, abn, createdAt]
  );
}

/** A 10 kg pack, shared by both vendors' offers when given the same one. */
async function pack(): Promise<string> {
  seq += 1;
  const itemId = await scalar<string>(
    db,
    "insert into items (name, canonical_unit_id, category_id) values ($1, $2, $3) returning id",
    [`Merge test ${seq}`, ids.kg, ids.category]
  );
  return scalar<string>(
    db,
    `insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, contents_confirmed)
     values ($1, 10, $2, 1, true) returning id`,
    [itemId, ids.kg]
  );
}

async function offer(vendorId: string, packId: string, price: number): Promise<string> {
  return scalar<string>(
    db,
    "insert into pricelist_items (pack_size_id, vendor_id, pack_price, status) values ($1, $2, $3, 'approved') returning id",
    [packId, vendorId, price]
  );
}

async function expense(vendorId: string, offerId: string): Promise<{ expenseId: string; lineId: string }> {
  const expenseId = await scalar<string>(
    db,
    `insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri)
     values ($1, $2, 'submitted', '2026-09-01', 50, 1447) returning id`,
    [ids.profile, vendorId]
  );
  const lineId = await scalar<string>(
    db,
    `insert into expense_line_items (expense_id, pricelist_item_id, description_raw, kind, quantity, line_total)
     values ($1, $2, 'line', 'goods', 1, 50) returning id`,
    [expenseId, offerId]
  );
  return { expenseId, lineId };
}

const one = <T>(sql: string, params: unknown[]) => db.query<T>(sql, params).then((r) => r.rows[0]!);

describe("merging vendors (#44)", () => {
  test("Nimco Foods: the newer copy merges into the older, and undo puts it back", async () => {
    const older = await vendor("FULBECK PTY. LIMITED T/A Nimco Foods", "37003900427", "2026-09-27T05:36:41Z");
    const newer = await vendor("Nimco Foods", "03003900427", "2026-09-27T07:24:27Z");
    const p = await pack();
    const keptOffer = await offer(older, p, 114);
    const dupOffer = await offer(newer, p, 98);
    const { expenseId, lineId } = await expense(newer, dupOffer);

    const mergeId = await scalar<string>(db, "select merge_vendors($1, $2, $3)", [newer, older, ids.profile]);

    assert.equal(await scalar(db, "select vendor_id from expenses where id = $1", [expenseId]), older);
    assert.equal(await scalar(db, "select pricelist_item_id from expense_line_items where id = $1", [lineId]), keptOffer);
    assert.equal(await scalar(db, "select status::text from pricelist_items where id = $1", [dupOffer]), "rejected");
    const gone = await one<{ merged_into: string; abn: string | null; name: string }>(
      "select merged_into, abn, name from vendors where id = $1",
      [newer]
    );
    assert.equal(gone.merged_into, older);
    assert.equal(gone.abn, null);
    // A dash, not brackets: loose name matching (#45) ignores what's bracketed,
    // and this name must match nothing.
    assert.match(gone.name, /^Nimco Foods — merged into V-/);

    await db.query("select undo_vendor_merge($1, $2)", [mergeId, ids.profile]);

    assert.equal(await scalar(db, "select vendor_id from expenses where id = $1", [expenseId]), newer);
    assert.equal(await scalar(db, "select pricelist_item_id from expense_line_items where id = $1", [lineId]), dupOffer);
    assert.equal(await scalar(db, "select status::text from pricelist_items where id = $1", [dupOffer]), "approved");
    assert.deepEqual(
      await one("select name, abn, merged_into from vendors where id = $1", [newer]),
      { name: "Nimco Foods", abn: "03003900427", merged_into: null }
    );
    await assert.rejects(db.query("select undo_vendor_merge($1, $2)", [mergeId, ids.profile]), /already been undone/);
  });

  test("keeping the newer vendor's details still keeps the older number", async () => {
    const older = await vendor("Aldi", null, "2026-09-01T00:00:00Z");
    const newer = await vendor("ALDI STORES (A LIMITED PARTNERSHIP)", "90196565019", "2026-09-20T00:00:00Z");
    const olderNumber = await scalar<string>(db, "select vendor_number from vendors where id = $1", [older]);

    await db.query("select merge_vendors($1, $2, $3)", [older, newer, ids.profile]);

    const kept = await one<{ vendor_number: string; name: string; abn: string; merged_into: string | null }>(
      "select vendor_number, name, abn, merged_into from vendors where id = $1",
      [older]
    );
    assert.deepEqual(kept, {
      vendor_number: olderNumber,
      name: "ALDI STORES (A LIMITED PARTNERSHIP)",
      abn: "90196565019",
      merged_into: null,
    });
    assert.equal(await scalar(db, "select merged_into from vendors where id = $1", [newer]), older);
  });

  test("undo is refused once a new expense lands on an offer the merge combined", async () => {
    const older = await vendor("Harkola A", null, "2026-08-01T00:00:00Z");
    const newer = await vendor("Harkola B", null, "2026-08-02T00:00:00Z");
    const p = await pack();
    const keptOffer = await offer(older, p, 10);
    await offer(newer, p, 11);

    const mergeId = await scalar<string>(db, "select merge_vendors($1, $2, $3)", [newer, older, ids.profile]);
    await expense(older, keptOffer);

    await assert.rejects(
      db.query("select undo_vendor_merge($1, $2)", [mergeId, ids.profile]),
      /can't be split back/
    );
  });

  test("two approved payees: the merged one's is superseded, and undo restores it", async () => {
    const older = await vendor("Payee A", null, "2026-07-01T00:00:00Z");
    const newer = await vendor("Payee B", null, "2026-07-02T00:00:00Z");
    const payee = (vendorId: string) =>
      scalar<string>(
        db,
        "insert into payees (display_name, vendor_id, status) values ('p', $1, 'approved') returning id",
        [vendorId]
      );
    const keptPayee = await payee(older);
    const otherPayee = await payee(newer);

    const mergeId = await scalar<string>(db, "select merge_vendors($1, $2, $3)", [newer, older, ids.profile]);
    assert.deepEqual(await one("select status, superseded_by, vendor_id from payees where id = $1", [otherPayee]), {
      status: "superseded",
      superseded_by: keptPayee,
      vendor_id: older,
    });

    await db.query("select undo_vendor_merge($1, $2)", [mergeId, ids.profile]);
    assert.deepEqual(await one("select status, superseded_by, vendor_id from payees where id = $1", [otherPayee]), {
      status: "approved",
      superseded_by: null,
      vendor_id: newer,
    });
  });
});

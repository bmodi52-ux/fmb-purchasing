import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { applyMigration, createTestDb, scalar, type TestDb } from "./test-db.ts";

/**
 * Migration 0082 (#57): withdrawing, declining or editing a receipt puts its
 * offers' prices back as they were — date and source too, not only a price
 * that moved.
 *
 * Found on the sandbox: a receipt that confirmed Jumbo Ginger's $75 was
 * withdrawn, and the offer stayed dated from it. A genuine receipt dated
 * before that would then have been skipped as older than the current price.
 */

type Ids = { profile: string; vendor: string; category: string; kg: string };
let seq = 0;

async function setUp(db: TestDb): Promise<Ids> {
  const profile = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data)
     values ('undo@test.local', '{"full_name": "Undo Test"}'::jsonb) returning id`
  );
  const vendor = await scalar<string>(db, "insert into vendors (name, status) values ('KMA', 'approved') returning id");
  const category = await scalar<string>(db, "select id from categories where name = 'Miscellaneous'");
  const kg = await scalar<string>(db, "select id from units where code = 'kg'");
  return { profile, vendor, category, kg };
}

/** A 6 kg box with an offer at $price, dated `day` and from no receipt. */
async function offer(db: TestDb, ids: Ids, price: number, day: string): Promise<string> {
  seq += 1;
  const itemId = await scalar<string>(
    db,
    "insert into items (name, canonical_unit_id, category_id) values ($1, $2, $3) returning id",
    [`Undo test ${seq}`, ids.kg, ids.category]
  );
  const packId = await scalar<string>(
    db,
    `insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, contents_confirmed)
     values ($1, 6, $2, 1, true) returning id`,
    [itemId, ids.kg]
  );
  return scalar<string>(
    db,
    `insert into pricelist_items (pack_size_id, vendor_id, pack_price, price_set_at, status)
     values ($1, $2, $3, $4, 'approved') returning id`,
    [packId, ids.vendor, price, day]
  );
}

/** A receipt of `day` buying one box of the offer at `price`, priced onto it. */
async function receipt(db: TestDb, ids: Ids, offerId: string, price: number, day: string): Promise<string> {
  const expenseId = await scalar<string>(
    db,
    `insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri)
     values ($1, $2, 'submitted', $3, $4, 1447) returning id`,
    [ids.profile, ids.vendor, day, price]
  );
  await db.query(
    `insert into expense_line_items (expense_id, pricelist_item_id, description_raw, kind, quantity, line_total)
     values ($1, $2, 'GINGER 6KG', 'goods', 1, $3)`,
    [expenseId, offerId, price]
  );
  await db.query("select price_offers_from_expense($1)", [expenseId]);
  return expenseId;
}

async function withdraw(db: TestDb, expenseId: string) {
  await db.query("update expenses set status = 'withdrawn' where id = $1", [expenseId]);
  await db.query("select restore_offer_prices($1)", [[expenseId]]);
}

/** The edit path: the lines are replaced, then the offers priced again. */
async function edit(db: TestDb, ids: Ids, expenseId: string, offerId: string, price: number) {
  const lines = [
    {
      pricelist_item_id: offerId,
      description_raw: "GINGER 6KG",
      kind: "goods",
      quantity: 1,
      line_subtotal: price,
      line_gst: 0,
      line_total: price,
      gst_applicable: false,
    },
  ];
  await db.query("select write_expense_children($1, $2::jsonb, '[]'::jsonb, $3)", [expenseId, JSON.stringify(lines), ids.profile]);
  await db.query("update expenses set total = $2 where id = $1", [expenseId, price]);
  await db.query("select price_offers_from_expense($1)", [expenseId]);
}

async function priceOf(db: TestDb, offerId: string) {
  const r = await db.query<{ price: string | null; day: string | null; from_receipt: boolean }>(
    `select pack_price as price, to_char(price_set_at, 'YYYY-MM-DD') as day,
            price_source_line_id is not null as from_receipt
     from pricelist_items where id = $1`,
    [offerId]
  );
  const row = r.rows[0]!;
  return { price: row.price == null ? null : Number(row.price), day: row.day, fromReceipt: row.from_receipt };
}

describe("0082 puts an offer's price back as it was", () => {
  let db: TestDb;
  let ids: Ids;

  before(async () => {
    db = await createTestDb();
    ids = await setUp(db);
  });

  after(async () => {
    await db?.close();
  });

  test("a withdrawn receipt that confirmed the price takes its date and source with it", async () => {
    const o = await offer(db, ids, 75, "2026-08-17");
    const confirming = await receipt(db, ids, o, 75, "2026-09-28");
    assert.deepEqual(await priceOf(db, o), { price: 75, day: "2026-09-28", fromReceipt: true });

    await withdraw(db, confirming);
    assert.deepEqual(await priceOf(db, o), { price: 75, day: "2026-08-17", fromReceipt: false });

    // The receipt 0078 would have skipped as older than 28/09.
    await receipt(db, ids, o, 80, "2026-09-20");
    assert.deepEqual(await priceOf(db, o), { price: 80, day: "2026-09-20", fromReceipt: true });
  });

  test("withdrawing steps back past an earlier receipt that no longer counts either", async () => {
    const o = await offer(db, ids, 75, "2026-08-01");
    const raised = await receipt(db, ids, o, 80, "2026-09-01");
    const confirmed = await receipt(db, ids, o, 80, "2026-09-10");

    await withdraw(db, raised);
    assert.deepEqual(await priceOf(db, o), { price: 80, day: "2026-09-10", fromReceipt: true }, "still confirmed by the later one");

    await withdraw(db, confirmed);
    assert.deepEqual(await priceOf(db, o), { price: 75, day: "2026-08-01", fromReceipt: false });
  });

  test("an edited receipt, then withdrawn, leaves nothing behind", async () => {
    const o = await offer(db, ids, 75, "2026-08-01");
    const r = await receipt(db, ids, o, 80, "2026-09-01");

    await edit(db, ids, r, o, 80);
    assert.deepEqual(await priceOf(db, o), { price: 80, day: "2026-09-01", fromReceipt: true });
    await edit(db, ids, r, o, 90);
    assert.deepEqual(await priceOf(db, o), { price: 90, day: "2026-09-01", fromReceipt: true });

    await withdraw(db, r);
    assert.deepEqual(await priceOf(db, o), { price: 75, day: "2026-08-01", fromReceipt: false });
  });

  test("an earlier source line that no longer exists leaves no source, rather than failing", async () => {
    const o = await offer(db, ids, 75, "2026-08-01");
    const first = await receipt(db, ids, o, 80, "2026-09-01");
    const second = await receipt(db, ids, o, 80, "2026-09-05");
    // The first receipt's line is replaced by an edit while the second is the source.
    await edit(db, ids, first, o, 80);

    await withdraw(db, second);
    assert.deepEqual(await priceOf(db, o), { price: 80, day: "2026-09-01", fromReceipt: false });
  });

  test("the history shows a receipt that changed the price, not one that confirmed it", async () => {
    const o = await offer(db, ids, 75, "2026-08-01");
    await receipt(db, ids, o, 80, "2026-09-01");
    await receipt(db, ids, o, 80, "2026-09-05");
    const r = await db.query<{ shown: number; undo_only: number }>(
      `select count(*) filter (where changes ? 'pack_price')::int as shown,
              count(*) filter (where not exists (select 1 from jsonb_object_keys(changes) k where k not like '\\_%'))::int as undo_only
       from pricelist_item_history where item_id = $1`,
      [o]
    );
    assert.deepEqual(r.rows[0], { shown: 1, undo_only: 1 });
  });
});

describe("0082 repairs offers already dated from a receipt that no longer counts", () => {
  let db: TestDb;
  let ids: Ids;

  before(async () => {
    db = await createTestDb({ stopBefore: "0082_price_undo.sql" });
    ids = await setUp(db);
  });

  after(async () => {
    await db?.close();
  });

  test("it is dated from its latest receipt that still counts at that price, or from its last edit", async () => {
    const bought = await offer(db, ids, 75, "2026-08-17");
    await receipt(db, ids, bought, 75, "2026-09-10");
    const stale = await receipt(db, ids, bought, 75, "2026-09-28");

    const neverBought = await offer(db, ids, 60, "2026-08-17");
    await db.query("update pricelist_items set updated_at = '2026-09-01' where id = $1", [neverBought]);
    const staleOnly = await receipt(db, ids, neverBought, 60, "2026-09-28");

    // 0078's undo leaves both dated 28/09 from a withdrawn receipt.
    await withdraw(db, stale);
    await withdraw(db, staleOnly);
    assert.deepEqual(await priceOf(db, bought), { price: 75, day: "2026-09-28", fromReceipt: true });

    await applyMigration(db, "0082_price_undo.sql");

    assert.deepEqual(await priceOf(db, bought), { price: 75, day: "2026-09-10", fromReceipt: true });
    assert.deepEqual(await priceOf(db, neverBought), { price: 60, day: "2026-09-01", fromReceipt: false });
  });
});

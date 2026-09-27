import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";

/**
 * Migration 0078 (#46): one live offer per store + pack + brand, and receipts
 * keeping offer prices current. The rules are SQL, so they're tested here
 * against the real migrations.
 */

let db: TestDb;
const ids = { profile: "", vendor: "", category: "", kg: "" };
let seq = 0;

before(async () => {
  db = await createTestDb();
  ids.profile = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data)
     values ('prices@test.local', '{"full_name": "Prices Test"}'::jsonb) returning id`
  );
  ids.vendor = await scalar<string>(db, "insert into vendors (name, status) values ('Campbells', 'approved') returning id");
  ids.category = await scalar<string>(db, "select id from categories where name = 'Miscellaneous'");
  ids.kg = await scalar<string>(db, "select id from units where code = 'kg'");
});

after(async () => {
  await db?.close();
});

/** A 10 kg pack with an offer at $packPrice, its price dated priceSetAt. */
async function offer(packPrice: number | null, priceSetAt: string | null): Promise<{ offerId: string; packId: string }> {
  seq += 1;
  const itemId = await scalar<string>(
    db,
    "insert into items (name, canonical_unit_id, category_id) values ($1, $2, $3) returning id",
    [`Prices test ${seq}`, ids.kg, ids.category]
  );
  const packId = await scalar<string>(
    db,
    `insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, contents_confirmed)
     values ($1, 10, $2, 1, true) returning id`,
    [itemId, ids.kg]
  );
  const offerId = await scalar<string>(
    db,
    `insert into pricelist_items (pack_size_id, vendor_id, pack_price, price_set_at, status)
     values ($1, $2, $3, $4, 'approved') returning id`,
    [packId, ids.vendor, packPrice, priceSetAt]
  );
  return { offerId, packId };
}

/** A receipt buying `packs` of the offer's pack for lineTotal. */
async function receipt(
  offerId: string,
  opts: { packs: number; lineTotal: number; date: string; status?: string; readsAsKg?: number }
): Promise<string> {
  const expenseId = await scalar<string>(
    db,
    `insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri)
     values ($1, $2, $3, $4, $5, 1447) returning id`,
    [ids.profile, ids.vendor, opts.status ?? "submitted", opts.date, opts.lineTotal]
  );
  await db.query(
    `insert into expense_line_items
       (expense_id, pricelist_item_id, description_raw, kind, quantity, line_total, normalized_quantity, normalized_unit)
     values ($1, $2, 'line', 'goods', $3, $4, $5, $6)`,
    [expenseId, offerId, opts.packs, opts.lineTotal, opts.readsAsKg ?? null, opts.readsAsKg ? "kg" : null]
  );
  await db.query("select price_offers_from_expense($1)", [expenseId]);
  return expenseId;
}

async function priceOf(offerId: string) {
  const r = await db.query<{ pack_price: string | null; day: string | null }>(
    "select pack_price, to_char(price_set_at, 'YYYY-MM-DD') as day from pricelist_items where id = $1",
    [offerId]
  );
  return { price: r.rows[0]!.pack_price == null ? null : Number(r.rows[0]!.pack_price), day: r.rows[0]!.day };
}

describe("receipts keep offer prices current (#46)", () => {
  test("a newer receipt sets the price, dated by the receipt, with history", async () => {
    const { offerId } = await offer(98, "2026-07-10");
    await receipt(offerId, { packs: 2, lineTotal: 228, date: "2026-09-19" });
    assert.deepEqual(await priceOf(offerId), { price: 114, day: "2026-09-19" });
    const history = await scalar<string>(
      db,
      "select changes -> 'price_source' ->> 'new' from pricelist_item_history where item_id = $1",
      [offerId]
    );
    assert.match(history, /receipt/);
  });

  test("an older receipt is recorded but doesn't become the price", async () => {
    const { offerId } = await offer(114, "2026-09-19");
    await receipt(offerId, { packs: 1, lineTotal: 98, date: "2026-07-10" });
    assert.deepEqual(await priceOf(offerId), { price: 114, day: "2026-09-19" });
  });

  test("a declined expense doesn't count, and declining restores the price", async () => {
    const { offerId } = await offer(100, "2026-08-01");
    await receipt(offerId, { packs: 1, lineTotal: 90, date: "2026-09-01", status: "declined" });
    assert.equal((await priceOf(offerId)).price, 100);

    const expenseId = await receipt(offerId, { packs: 1, lineTotal: 120, date: "2026-09-02" });
    assert.equal((await priceOf(offerId)).price, 120);
    await db.query("update expenses set status = 'declined' where id = $1", [expenseId]);
    await db.query("select restore_offer_prices($1)", [[expenseId]]);
    assert.deepEqual(await priceOf(offerId), { price: 100, day: "2026-08-01" });
  });

  test("restoring leaves an expense that wasn't declined alone", async () => {
    const { offerId } = await offer(100, "2026-08-01");
    const expenseId = await receipt(offerId, { packs: 1, lineTotal: 120, date: "2026-09-02" });
    await db.query("select restore_offer_prices($1)", [[expenseId]]);
    assert.equal((await priceOf(offerId)).price, 120);
  });

  test("a line whose pack disagrees, or a credit, never sets a price", async () => {
    const { offerId } = await offer(50, "2026-08-01");
    // Two 10 kg packs that the receipt reads as 2 kg: ten times apart.
    await receipt(offerId, { packs: 2, lineTotal: 20, date: "2026-09-01", readsAsKg: 2 });
    await receipt(offerId, { packs: 1, lineTotal: -50, date: "2026-09-02" });
    assert.equal((await priceOf(offerId)).price, 50);
  });

  test("a price changed by hand is dated now and has no receipt behind it", async () => {
    const { offerId } = await offer(50, "2026-08-01");
    await receipt(offerId, { packs: 1, lineTotal: 55, date: "2026-09-01" });
    await db.query("update pricelist_items set pack_price = 60 where id = $1", [offerId]);
    const r = await db.query<{ today: boolean; source: string | null }>(
      "select price_set_at::date = current_date as today, price_source_line_id as source from pricelist_items where id = $1",
      [offerId]
    );
    assert.deepEqual(r.rows[0], { today: true, source: null });
  });
});

describe("one live offer per store, pack and brand (#46)", () => {
  test("a second live offer is refused; another brand or a rejected one is not", async () => {
    const { packId } = await offer(10, "2026-08-01");
    const insert = (brand: string | null, status: string) =>
      db.query(
        "insert into pricelist_items (pack_size_id, vendor_id, pack_price, brand, status) values ($1, $2, 11, $3, $4)",
        [packId, ids.vendor, brand, status]
      );
    await assert.rejects(insert(null, "pending"), /pricelist_items_one_live_offer/);
    await insert("Bulla", "approved");
    await assert.rejects(insert(" bulla ", "pending"), /pricelist_items_one_live_offer/);
    await insert(null, "rejected");
  });
});

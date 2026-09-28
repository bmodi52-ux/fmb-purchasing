import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { applyMigration, createTestDb, scalar, type TestDb } from "./test-db.ts";

/**
 * Migration 0081 (#55): a store's wording remembers the offer it was filed
 * against, and merging two items keeps one offer per store, pack and brand
 * rather than one per store and pack.
 */

type Ids = { profile: string; vendor: string; category: string; kg: string };

async function setUp(db: TestDb): Promise<Ids> {
  const profile = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data)
     values ('brands@test.local', '{"full_name": "Brands Test"}'::jsonb) returning id`
  );
  const vendor = await scalar<string>(db, "insert into vendors (name, status) values ('Campbells', 'approved') returning id");
  const category = await scalar<string>(db, "select id from categories where name = 'Miscellaneous'");
  const kg = await scalar<string>(db, "select id from units where code = 'kg'");
  return { profile, vendor, category, kg };
}

async function item(db: TestDb, ids: Ids, name: string): Promise<string> {
  return scalar<string>(db, "insert into items (name, canonical_unit_id, category_id) values ($1, $2, $3) returning id", [
    name,
    ids.kg,
    ids.category,
  ]);
}

async function tenKiloPack(db: TestDb, ids: Ids, itemId: string): Promise<string> {
  return scalar<string>(
    db,
    `insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, contents_confirmed)
     values ($1, 10, $2, 1, true) returning id`,
    [itemId, ids.kg]
  );
}

async function offer(
  db: TestDb,
  ids: Ids,
  packId: string,
  brand: string | null,
  opts: { price?: number | null; status?: string } = {}
): Promise<string> {
  return scalar<string>(
    db,
    `insert into pricelist_items (pack_size_id, vendor_id, brand, pack_price, status)
     values ($1, $2, $3, $4, $5) returning id`,
    [packId, ids.vendor, brand, opts.price ?? null, opts.status ?? "approved"]
  );
}

/** A receipt line with this wording, filed against the offer. */
async function line(db: TestDb, ids: Ids, offerId: string, wording: string): Promise<string> {
  const expenseId = await scalar<string>(
    db,
    `insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri)
     values ($1, $2, 'submitted', '2026-09-20', 50, 1447) returning id`,
    [ids.profile, ids.vendor]
  );
  return scalar<string>(
    db,
    `insert into expense_line_items (expense_id, pricelist_item_id, description_raw, kind, quantity, line_total)
     values ($1, $2, $3, 'goods', 1, 50) returning id`,
    [expenseId, offerId, wording]
  );
}

async function wording(db: TestDb, ids: Ids, itemId: string, text: string): Promise<string> {
  return scalar<string>(
    db,
    `insert into vendor_item_descriptions (item_id, vendor_id, description, description_normalized)
     values ($1, $2, $3, lower(regexp_replace(btrim($3), '\\s+', ' ', 'g'))) returning id`,
    [itemId, ids.vendor, text]
  );
}

async function offerOfWording(db: TestDb, wordingId: string): Promise<string | null> {
  return scalar<string | null>(db, "select pricelist_item_id from vendor_item_descriptions where id = $1", [wordingId]);
}

async function wordingVaries(db: TestDb, wordingId: string): Promise<boolean> {
  return scalar<boolean>(db, "select offer_varies from vendor_item_descriptions where id = $1", [wordingId]);
}

describe("0081 remembers which offer a store's past wording meant", () => {
  let db: TestDb;
  let ids: Ids;

  before(async () => {
    db = await createTestDb({ stopBefore: "0081_brand_offers.sql" });
    ids = await setUp(db);
  });

  after(async () => {
    await db?.close();
  });

  test("a wording that only ever went to one offer means it; one that went to two varies", async () => {
    const rice = await item(db, ids, "Basmati Rice");
    const pack = await tenKiloPack(db, ids, rice);
    const tilda = await offer(db, ids, pack, "Tilda", { price: 54 });
    const sunrice = await offer(db, ids, pack, "SunRice", { price: 48 });
    const retired = await offer(db, ids, pack, "Daawat", { status: "rejected" });

    await line(db, ids, tilda, "TILDA BASMATI 10KG");
    await line(db, ids, tilda, "Tilda  Basmati 10kg");
    await line(db, ids, sunrice, "SUNRICE BASMATI 10KG");
    await line(db, ids, tilda, "BASMATI RICE 10KG");
    await line(db, ids, sunrice, "BASMATI RICE 10KG");
    await line(db, ids, retired, "DAAWAT BASMATI 10KG");

    const tildaWording = await wording(db, ids, rice, "TILDA BASMATI 10KG");
    const sunriceWording = await wording(db, ids, rice, "SUNRICE BASMATI 10KG");
    const sharedWording = await wording(db, ids, rice, "BASMATI RICE 10KG");
    const retiredWording = await wording(db, ids, rice, "DAAWAT BASMATI 10KG");
    const neverBought = await wording(db, ids, rice, "RICE BASMATI 10 KILO");

    await applyMigration(db, "0081_brand_offers.sql");

    assert.equal(await offerOfWording(db, tildaWording), tilda);
    assert.equal(await offerOfWording(db, sunriceWording), sunrice);
    assert.equal(await wordingVaries(db, tildaWording), false);
    assert.equal(await offerOfWording(db, sharedWording), null);
    assert.equal(await wordingVaries(db, sharedWording), true, "one wording for two brands asks from now on");
    assert.equal(await offerOfWording(db, retiredWording), null, "a rejected offer is never what a wording means");
    assert.equal(await wordingVaries(db, retiredWording), false);
    assert.equal(await offerOfWording(db, neverBought), null);
    assert.equal(await wordingVaries(db, neverBought), false);
  });

  test("deleting an offer forgets it rather than blocking the delete", async () => {
    const flour = await item(db, ids, "Plain Flour");
    const pack = await tenKiloPack(db, ids, flour);
    const own = await offer(db, ids, pack, "Lighthouse");
    const w = await wording(db, ids, flour, "LIGHTHOUSE PLAIN FLOUR");
    await db.query("update vendor_item_descriptions set pricelist_item_id = $1 where id = $2", [own, w]);

    await db.query("delete from pricelist_items where id = $1", [own]);
    assert.equal(await offerOfWording(db, w), null);
  });
});

describe("merge_items keeps one offer per store, pack and brand", () => {
  let db: TestDb;
  let ids: Ids;

  before(async () => {
    db = await createTestDb();
    ids = await setUp(db);
  });

  after(async () => {
    await db?.close();
  });

  async function offersOn(packId: string) {
    const r = await db.query<{ id: string; brand: string | null; pack_price: string | null }>(
      "select id, brand, pack_price from pricelist_items where pack_size_id = $1 and status <> 'rejected' order by brand",
      [packId]
    );
    return r.rows;
  }

  test("two brands of the winner's pack both survive the merge", async () => {
    const winner = await item(db, ids, "Chickpeas");
    const loser = await item(db, ids, "Chick Peas");
    const pack = await tenKiloPack(db, ids, winner);
    await offer(db, ids, pack, "Ziyad", { price: 40 });
    await offer(db, ids, pack, "Sunfield", { price: 35 });
    await tenKiloPack(db, ids, loser);

    await db.query("select merge_items($1, $2, $3)", [loser, winner, ids.profile]);

    assert.deepEqual(
      (await offersOn(pack)).map((o) => o.brand),
      ["Sunfield", "Ziyad"]
    );
  });

  test("the same brand on a folded pack becomes one offer, carrying its lines and wordings", async () => {
    const winner = await item(db, ids, "Red Lentils");
    const loser = await item(db, ids, "Lentils Red");
    const winnerPack = await tenKiloPack(db, ids, winner);
    const loserPack = await tenKiloPack(db, ids, loser);
    const kept = await offer(db, ids, winnerPack, "Tilda", { price: 30 });
    const folded = await offer(db, ids, loserPack, "tilda ", { price: null });
    const otherBrand = await offer(db, ids, loserPack, "SunRice", { price: 28 });
    const lineId = await line(db, ids, folded, "TILDA RED LENTILS");
    const w = await wording(db, ids, loser, "TILDA RED LENTILS");
    await db.query("update vendor_item_descriptions set pricelist_item_id = $1 where id = $2", [folded, w]);

    const result = await scalar<{ offers_merged: number; line_items_repointed: number }>(
      db,
      "select merge_items($1, $2, $3)",
      [loser, winner, ids.profile]
    );
    assert.equal(result.offers_merged, 1);
    assert.equal(result.line_items_repointed, 1);

    const offers = await offersOn(winnerPack);
    assert.deepEqual(
      offers.map((o) => o.id).sort(),
      [kept, otherBrand].sort(),
      "the priced Tilda offer is kept and SunRice moves across as its own offer"
    );
    assert.equal(await scalar<string>(db, "select pricelist_item_id from expense_line_items where id = $1", [lineId]), kept);
    assert.equal(await offerOfWording(db, w), kept);
    assert.equal(await scalar<string>(db, "select item_id from vendor_item_descriptions where id = $1", [w]), winner);
  });

  test("a wording both items remember for different offers varies", async () => {
    const winner = await item(db, ids, "Ghee");
    const loser = await item(db, ids, "Ghee Pure");
    const winnerPack = await tenKiloPack(db, ids, winner);
    const winnerOffer = await offer(db, ids, winnerPack, "Amul");
    const loserPack = await scalar<string>(
      db,
      `insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, contents_confirmed)
       values ($1, 5, $2, 1, true) returning id`,
      [loser, ids.kg]
    );
    const loserOffer = await offer(db, ids, loserPack, "Amul");
    const kept = await wording(db, ids, winner, "AMUL GHEE");
    const dropped = await wording(db, ids, loser, "AMUL GHEE");
    await db.query("update vendor_item_descriptions set pricelist_item_id = $1 where id = $2", [winnerOffer, kept]);
    await db.query("update vendor_item_descriptions set pricelist_item_id = $1 where id = $2", [loserOffer, dropped]);

    await db.query("select merge_items($1, $2, $3)", [loser, winner, ids.profile]);

    assert.equal(await offerOfWording(db, kept), null);
    assert.equal(await wordingVaries(db, kept), true);
    assert.equal(
      await scalar<number>(db, "select count(*)::int from vendor_item_descriptions where id = $1", [dropped]),
      0
    );
  });
});

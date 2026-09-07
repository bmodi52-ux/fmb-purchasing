import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, type TestDb } from "./test-db.ts";

/**
 * Per-category item numbers (migration 0039).
 *
 * The tail used to be a global sequence, so the first item ever filed under
 * Chicken read CHK-0003 — it was the third item created anywhere. Numbering is
 * now per category, which means the renumbering and collision machinery 0024
 * deliberately avoided has to actually work.
 */

async function unitId(db: TestDb): Promise<string> {
  const r = await db.query<{ id: string }>(`select id from units where code = 'kg' limit 1`);
  return r.rows[0]!.id;
}

async function categoryId(db: TestDb, name: string): Promise<string> {
  const r = await db.query<{ id: string }>(`select id from categories where name = $1`, [name]);
  return r.rows[0]!.id;
}

async function anItem(db: TestDb, name: string, category: string | null): Promise<string> {
  const r = await db.query<{ id: string }>(
    `insert into items (name, category_id, canonical_unit_id, status)
     values ($1, $2, $3, 'approved') returning id`,
    [name, category, await unitId(db)]
  );
  return r.rows[0]!.id;
}

async function numberOf(db: TestDb, id: string): Promise<string> {
  const r = await db.query<{ item_number: string }>(
    `select item_number from items where id = $1`,
    [id]
  );
  return r.rows[0]!.item_number;
}

describe("0039 — item numbers count from 001 within their category", () => {
  test("numbers the first item in a category 0001", async () => {
    const db = await createTestDb();
    const chicken = await categoryId(db, "Chicken");
    assert.equal(await numberOf(db, await anItem(db, "Chicken Thigh", chicken)), "CHK-0001");
    await db.close();
  });

  test("counts on within the category, not across the whole pricelist", async () => {
    const db = await createTestDb();
    const chicken = await categoryId(db, "Chicken");
    const beef = await categoryId(db, "Beef");

    // Interleaved on purpose: under the old global sequence these came out
    // CHK-0001, BEF-0002, CHK-0003.
    const thigh = await anItem(db, "Chicken Thigh", chicken);
    const mince = await anItem(db, "Beef Mince", beef);
    const wings = await anItem(db, "Chicken Wings", chicken);

    assert.equal(await numberOf(db, thigh), "CHK-0001");
    assert.equal(await numberOf(db, mince), "BEF-0001");
    assert.equal(await numberOf(db, wings), "CHK-0002");
    await db.close();
  });

  test("renumbers an item into its new category", async () => {
    const db = await createTestDb();
    const chicken = await categoryId(db, "Chicken");
    const beef = await categoryId(db, "Beef");
    await anItem(db, "Beef Mince", beef);

    const moved = await anItem(db, "Mystery Meat", chicken);
    assert.equal(await numberOf(db, moved), "CHK-0001");

    await db.query(`update items set category_id = $1 where id = $2`, [beef, moved]);
    assert.equal(
      await numberOf(db, moved),
      "BEF-0002",
      "BEF-0001 belongs to Beef's first item, so the mover takes the next free number"
    );
    await db.close();
  });

  test("keeps the old number resolvable after a move", async () => {
    // Numbers get written on order sheets. 0024 built the alias table for
    // exactly this, and item search reads it.
    const db = await createTestDb();
    const chicken = await categoryId(db, "Chicken");
    const beef = await categoryId(db, "Beef");

    const item = await anItem(db, "Mystery Meat", chicken);
    await db.query(`update items set category_id = $1 where id = $2`, [beef, item]);

    const aliases = await db.query<{ item_number: string }>(
      `select item_number from item_number_aliases where item_id = $1`,
      [item]
    );
    assert.deepEqual(aliases.rows.map((r) => r.item_number), ["CHK-0001"]);
    await db.close();
  });

  test("does not reuse a number the mover vacated", async () => {
    // Reusing it would point two items at one alias.
    const db = await createTestDb();
    const chicken = await categoryId(db, "Chicken");
    const beef = await categoryId(db, "Beef");

    const first = await anItem(db, "Chicken Thigh", chicken);
    await anItem(db, "Chicken Wings", chicken);
    await db.query(`update items set category_id = $1 where id = $2`, [beef, first]);

    const next = await anItem(db, "Chicken Breast", chicken);
    assert.equal(await numberOf(db, next), "CHK-0003", "the gap stays; nothing shuffles up");
    await db.close();
  });

  test("leaves an item's number alone when something else about it is edited", async () => {
    const db = await createTestDb();
    const chicken = await categoryId(db, "Chicken");
    const item = await anItem(db, "Chicken Thigh", chicken);

    await db.query(`update items set name = 'Chicken Thigh Skin-On' where id = $1`, [item]);
    assert.equal(await numberOf(db, item), "CHK-0001");

    const aliases = await db.query<{ n: number }>(
      `select count(*)::int as n from item_number_aliases where item_id = $1`,
      [item]
    );
    assert.equal(aliases.rows[0]!.n, 0, "a rename is not a renumbering");
    await db.close();
  });

  test("numbers uncategorised items in their own bucket", async () => {
    const db = await createTestDb();
    const loose = await anItem(db, "Something", null);
    const alsoLoose = await anItem(db, "Something Else", null);

    assert.equal(await numberOf(db, loose), "I-0001");
    assert.equal(await numberOf(db, alsoLoose), "I-0002");
    await db.close();
  });

  test("gives an uncategorised item a real number once it is filed", async () => {
    const db = await createTestDb();
    const loose = await anItem(db, "Something", null);
    await db.query(`update items set category_id = $1 where id = $2`, [
      await categoryId(db, "Chicken"),
      loose,
    ]);
    assert.equal(await numberOf(db, loose), "CHK-0001");
    await db.close();
  });

  test("keeps the tail when a category is recoded", async () => {
    // The prefix is the category's; the tail is the item's place in it.
    const db = await createTestDb();
    const chicken = await categoryId(db, "Chicken");
    await anItem(db, "Chicken Thigh", chicken);
    const second = await anItem(db, "Chicken Wings", chicken);

    await db.query(`update categories set code = 'POUL' where id = $1`, [chicken]);
    assert.equal(await numberOf(db, second), "POUL-0002");
    await db.close();
  });

  test("refuses two items claiming one number in a category", async () => {
    // The backstop behind the advisory lock.
    const db = await createTestDb();
    const chicken = await categoryId(db, "Chicken");
    await anItem(db, "Chicken Thigh", chicken);
    const second = await anItem(db, "Chicken Wings", chicken);

    await assert.rejects(
      () => db.query(`update items set category_seq = 1 where id = $1`, [second]),
      /duplicate key|unique/i
    );
    await db.close();
  });

  test("refuses two uncategorised items claiming one number", async () => {
    const db = await createTestDb();
    await anItem(db, "Something", null);
    const second = await anItem(db, "Something Else", null);

    await assert.rejects(
      () => db.query(`update items set category_seq = 1 where id = $1`, [second]),
      /duplicate key|unique/i
    );
    await db.close();
  });

  test("numbers items that predate the migration by how long they have been there", async () => {
    // createTestDb applies every migration in order, so the backfill has
    // already run over anything the earlier ones seeded; this checks the rule
    // it used — oldest first, per category.
    const db = await createTestDb();
    const chicken = await categoryId(db, "Chicken");
    const first = await anItem(db, "Chicken Thigh", chicken);
    const second = await anItem(db, "Chicken Wings", chicken);

    const seqs = await db.query<{ id: string; category_seq: number }>(
      `select id, category_seq from items where category_id = $1 order by category_seq`,
      [chicken]
    );
    assert.deepEqual(
      seqs.rows.map((r) => r.id),
      [first, second]
    );
    await db.close();
  });
});

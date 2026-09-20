import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";

/**
 * Migration 0061 — menus, dishes and recipes (#70).
 *
 * What is checked here is what the forms rely on and cannot enforce alone: a
 * batch recipe that doesn't say how big a batch is would make every quantity
 * on every day using it wrong, and two dishes with the same name would make
 * the library useless for picking from.
 */

let db: TestDb;
const ids = { kitchen: "", item: "", unit: "" };

before(async () => {
  db = await createTestDb();
  ids.kitchen = await scalar<string>(db, "select id from kitchens order by sort_order limit 1");
  ids.unit = await scalar<string>(db, "select id from units where code = 'kg'");
  ids.item = await scalar<string>(
    db,
    `insert into items (name, canonical_unit_id, category_id)
     values ('Goat', $1, (select id from categories where name = 'Miscellaneous'))
     returning id`,
    [ids.unit]
  );
});

after(async () => {
  await db?.close();
});

describe("dishes", () => {
  test("two kitchens are there to plan for", async () => {
    assert.equal(await scalar<number>(db, "select count(*)::int as n from kitchens"), 2);
  });

  test("a batch recipe must say how many thaalis a batch makes", async () => {
    await assert.rejects(
      () => db.query("insert into dishes (name, recipe_basis) values ('Bhuna gosht', 'batch')"),
      /dishes_batch_size_required|check constraint/i
    );
  });

  test("a per-thaali recipe needs no batch size", async () => {
    await db.query("insert into dishes (name, recipe_basis) values ('Kadhi', 'thaali')");
    assert.equal(await scalar<string | null>(db, "select batch_thaalis from dishes where name = 'Kadhi'"), null);
  });

  test("the same dish cannot be written twice, whatever the capitals", async () => {
    await db.query("insert into dishes (name, recipe_basis, batch_thaalis) values ('Mug Pulao', 'batch', 200)");
    await assert.rejects(
      () => db.query("insert into dishes (name, recipe_basis, batch_thaalis) values ('mug pulao', 'batch', 100)"),
      /duplicate key|unique/i
    );
  });

  test("an ingredient goes with its dish when the dish goes", async () => {
    const dishId = await scalar<string>(
      db,
      "insert into dishes (name, recipe_basis, batch_thaalis) values ('Test dish', 'batch', 200) returning id"
    );
    await db.query(
      "insert into dish_ingredients (dish_id, item_id, quantity, unit_id) values ($1, $2, 120, $3)",
      [dishId, ids.item, ids.unit]
    );
    await db.query("delete from dishes where id = $1", [dishId]);
    assert.equal(await scalar<number>(db, "select count(*)::int as n from dish_ingredients where dish_id = $1", [dishId]), 0);
  });
});

describe("menu days", () => {
  test("one menu per kitchen per day", async () => {
    await db.query("insert into menu_days (kitchen_id, service_date, planned_thaalis) values ($1, '2026-09-18', 400)", [
      ids.kitchen,
    ]);
    await assert.rejects(
      () => db.query("insert into menu_days (kitchen_id, service_date) values ($1, '2026-09-18')", [ids.kitchen]),
      /duplicate key|unique/i
    );
  });

  test("the other kitchen cooks the same day for its own number", async () => {
    const other = await scalar<string>(db, "select id from kitchens order by sort_order offset 1 limit 1");
    await db.query("insert into menu_days (kitchen_id, service_date, planned_thaalis) values ($1, '2026-09-18', 150)", [
      other,
    ]);
    assert.equal(
      await scalar<number>(db, "select count(*)::int as n from menu_days where service_date = '2026-09-18'"),
      2
    );
  });

  test("a dish already on the day cannot be added twice", async () => {
    const dayId = await scalar<string>(
      db,
      "insert into menu_days (kitchen_id, service_date) values ($1, '2026-09-21') returning id",
      [ids.kitchen]
    );
    const dishId = await scalar<string>(
      db,
      "insert into dishes (name, recipe_basis, batch_thaalis) values ('Guvar aloo', 'batch', 200) returning id"
    );
    await db.query("insert into menu_day_dishes (menu_day_id, dish_id) values ($1, $2)", [dayId, dishId]);
    await assert.rejects(
      () => db.query("insert into menu_day_dishes (menu_day_id, dish_id) values ($1, $2)", [dayId, dishId]),
      /duplicate key|unique/i
    );
  });

  test("a dish that has been cooked cannot be deleted out from under the record", async () => {
    const dishId = await scalar<string>(db, "select dish_id from menu_day_dishes limit 1");
    await assert.rejects(() => db.query("delete from dishes where id = $1", [dishId]), /foreign key|violates/i);
  });

  test("menus & dishes is a page permissions can be granted on", async () => {
    assert.equal(await scalar<number>(db, "select count(*)::int as n from app_pages where key = 'menus'"), 1);
  });
});

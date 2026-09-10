import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";
import { PACKAGING, packagingFromText } from "./pack-description.ts";

/**
 * Packaging is a list kept twice — the check constraint in migration 0040 and
 * PACKAGING in pack-description.ts — and read out of text twice: by that
 * migration's backfill, and by packagingFromText on receipt lines. These pin
 * each pair together.
 */

let db: TestDb;
let unitKg = "";
let category = "";
let seq = 0;

before(async () => {
  db = await createTestDb();
  unitKg = await scalar<string>(db, "select id from units where code = 'kg'");
  category = await scalar<string>(db, "select id from categories where name = 'Miscellaneous'");
});

after(async () => {
  await db?.close();
});

async function insertPack(opts: { label?: string | null; packaging?: string | null; soldLoose?: boolean }) {
  seq += 1;
  const itemId = await scalar<string>(
    db,
    "insert into items (name, canonical_unit_id, category_id) values ($1, $2, $3) returning id",
    [`Packaging test ${seq}`, unitKg, category]
  );
  return scalar<string>(
    db,
    `insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, label, sold_loose, packaging)
     values ($1, 1, $2, 1, $3, $4, $5) returning id`,
    [itemId, unitKg, opts.label ?? null, opts.soldLoose ?? false, opts.packaging ?? null]
  );
}

describe("item_pack_sizes.packaging", () => {
  test("accepts every word the app offers, and no packaging at all", async () => {
    for (const packaging of PACKAGING) {
      await insertPack({ packaging });
    }
    await insertPack({ packaging: null });
  });

  test("refuses a word the app does not offer", async () => {
    await assert.rejects(() => insertPack({ packaging: "crate" }), /item_pack_sizes_packaging_check/);
  });

  test("the backfill reads names exactly as packagingFromText reads receipt lines", async () => {
    const labels = [
      "6 kg box",
      "1L x 10 carton",
      "carton of 10 bottles",
      "2 - pack",
      "Large Bag",
      "Potato SACK",
      "Coconut milk can",
      "Tinned tomatoes",
      "Green Chilli",
    ];
    const ids = new Map<string, string>();
    for (const label of labels) ids.set(label, await insertPack({ label }));
    const looseId = await insertPack({ label: "box", soldLoose: true });

    const migration = readFileSync(
      path.join(import.meta.dirname, "..", "..", "supabase", "migrations", "0040_pack_packaging.sql"),
      "utf8"
    );
    const backfill = migration.match(/^update item_pack_sizes[\s\S]*?;$/gm) ?? [];
    assert.ok(backfill.length === PACKAGING.length, "one backfill statement per packaging word");
    for (const statement of backfill) await db.exec(statement);

    for (const [label, id] of ids) {
      const stored = await scalar<string | null>(db, "select packaging from item_pack_sizes where id = $1", [id]);
      assert.equal(stored, packagingFromText(label), label);
    }
    assert.equal(
      await scalar<string | null>(db, "select packaging from item_pack_sizes where id = $1", [looseId]),
      null,
      "a loose pack has no packaging"
    );
  });
});

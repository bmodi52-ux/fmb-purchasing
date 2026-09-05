import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";

/**
 * The per-unit costing views — the money arithmetic the whole Pricelist and
 * Reports rest on, and the only substantial logic in this app that lives in
 * SQL rather than TypeScript.
 *
 *   offer_unit_costs      pack_price / (total_quantity * to_base_factor)
 *   item_paid_unit_costs  line_total / (quantity * total_quantity * to_base_factor)
 *   item_unit_costs       aggregates the above per item and base unit
 *
 * The second formula is what migration 0014 was written to fix. Before it, a
 * line was divided by whatever quantity the receipt happened to state, so
 * twelve cartons of thirty eggs at $720 reported $60 an egg rather than
 * $2.00. That case is pinned first and explicitly.
 *
 * A single database is shared across the file and each test inserts its own
 * items, because applying twenty-four migrations costs about three seconds
 * and nothing here mutates what another test reads.
 */

let db: TestDb;

/** Ids that every fixture needs, resolved once. */
const ids = {
  profile: "",
  vendor: "",
  category: "",
  units: {} as Record<string, string>,
};

before(async () => {
  db = await createTestDb();

  // The profile is not inserted directly: 0003 puts an on_auth_user_created
  // trigger on auth.users that provisions it and the default team membership,
  // so creating the auth row is the whole of it. Exercising that path is the
  // point — a fixture that wrote to profiles itself would skip the trigger
  // this app's user creation actually depends on.
  ids.profile = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data)
     values ('costing@test.local', '{"full_name": "Costing Test"}'::jsonb)
     returning id`
  );

  ids.vendor = await scalar<string>(
    db,
    "insert into vendors (name, status) values ('Test Vendor', 'approved') returning id"
  );
  ids.category = await scalar<string>(db, "select id from categories where name = 'Miscellaneous'");

  const units = await db.query<{ code: string; id: string }>("select code, id from units");
  for (const u of units.rows) ids.units[u.code] = u.id;
});

after(async () => {
  await db?.close();
});

/** An item with one pack size and one vendor offer — the whole hierarchy. */
async function seedItem(opts: {
  name: string;
  canonicalUnit: string;
  innerQuantity: number;
  innerUnit: string;
  packCount?: number;
  packPrice?: number;
  contentsConfirmed?: boolean;
  soldLoose?: boolean;
}): Promise<{ itemId: string; packSizeId: string; offerId: string }> {
  const itemId = await scalar<string>(
    db,
    "insert into items (name, canonical_unit_id, category_id) values ($1, $2, $3) returning id",
    [opts.name, ids.units[opts.canonicalUnit], ids.category]
  );

  const packSizeId = await scalar<string>(
    db,
    `insert into item_pack_sizes
       (item_id, inner_quantity, inner_unit_id, pack_count, label, sold_loose, contents_confirmed)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      itemId,
      opts.innerQuantity,
      ids.units[opts.innerUnit],
      opts.packCount ?? 1,
      opts.name,
      opts.soldLoose ?? false,
      opts.contentsConfirmed ?? true,
    ]
  );

  const offerId = await scalar<string>(
    db,
    `insert into pricelist_items (pack_size_id, vendor_id, pack_price, status)
     values ($1, $2, $3, 'approved') returning id`,
    [packSizeId, ids.vendor, opts.packPrice ?? null]
  );

  return { itemId, packSizeId, offerId };
}

/** One purchased line against an offer. */
async function seedPurchase(opts: {
  offerId: string;
  quantity: number | null;
  lineTotal: number;
  receiptDate?: string;
  status?: string;
}): Promise<string> {
  const expenseId = await scalar<string>(
    db,
    `insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri)
     values ($1, $2, $3, $4, $5, 1447) returning id`,
    [ids.profile, ids.vendor, opts.status ?? "approved", opts.receiptDate ?? "2026-08-01", opts.lineTotal]
  );

  await db.query(
    `insert into expense_line_items (expense_id, pricelist_item_id, description_raw, quantity, line_total)
     values ($1, $2, 'test line', $3, $4)`,
    [expenseId, opts.offerId, opts.quantity, opts.lineTotal]
  );

  return expenseId;
}

async function paidCost(itemId: string) {
  const r = await db.query<{
    base_quantity: string;
    cost_per_base_unit: string;
    base_unit_code: string;
  }>(
    "select base_quantity, cost_per_base_unit, base_unit_code from item_paid_unit_costs where item_id = $1",
    [itemId]
  );
  return r.rows.map((row) => ({
    baseQuantity: Number(row.base_quantity),
    costPerBaseUnit: Number(row.cost_per_base_unit),
    baseUnitCode: row.base_unit_code,
  }));
}

describe("item_paid_unit_costs", () => {
  test("divides by what the pack actually holds, not by the receipt's quantity", async () => {
    // The 0014 regression case: 12 cartons x 30 eggs for $720.
    const { itemId, offerId } = await seedItem({
      name: "Eggs",
      canonicalUnit: "ea",
      innerQuantity: 30,
      innerUnit: "ea",
      packPrice: 60,
    });
    await seedPurchase({ offerId, quantity: 12, lineTotal: 720 });

    const [row] = await paidCost(itemId);
    assert.equal(row.baseQuantity, 360, "12 cartons of 30 is 360 eggs");
    assert.equal(
      row.costPerBaseUnit,
      2.0,
      "$2.00 an egg — $60.00 would mean it divided by the receipt quantity again"
    );
  });

  test("handles a loose item sold by the base unit", async () => {
    const { itemId, offerId } = await seedItem({
      name: "Mutton",
      canonicalUnit: "kg",
      innerQuantity: 1,
      innerUnit: "kg",
      soldLoose: true,
      packPrice: 16.5,
    });
    await seedPurchase({ offerId, quantity: 80, lineTotal: 1320 });

    const [row] = await paidCost(itemId);
    assert.equal(row.baseQuantity, 80);
    assert.equal(row.costPerBaseUnit, 16.5);
  });

  test("converts grams to the kilogram base unit", async () => {
    // 4 x 500 g for $20 is 2 kg, so $10.00/kg — not $5.00 per "pack".
    const { itemId, offerId } = await seedItem({
      name: "Spice",
      canonicalUnit: "kg",
      innerQuantity: 500,
      innerUnit: "g",
      packPrice: 5,
    });
    await seedPurchase({ offerId, quantity: 4, lineTotal: 20 });

    const [row] = await paidCost(itemId);
    assert.equal(row.baseQuantity, 2);
    assert.equal(row.costPerBaseUnit, 10);
    assert.equal(row.baseUnitCode, "kg");
  });

  test("multiplies through pack_count as well as the inner quantity", async () => {
    // 3 purchases of a 4 x 250 mL carton for $18 is 3 L, so $6.00/L.
    const { itemId, offerId } = await seedItem({
      name: "Oil",
      canonicalUnit: "L",
      innerQuantity: 250,
      innerUnit: "mL",
      packCount: 4,
      packPrice: 6,
    });
    await seedPurchase({ offerId, quantity: 3, lineTotal: 18 });

    const [row] = await paidCost(itemId);
    assert.equal(row.baseQuantity, 3);
    assert.equal(row.costPerBaseUnit, 6);
    assert.equal(row.baseUnitCode, "L");
  });

  test("excludes declined expenses", async () => {
    const { itemId, offerId } = await seedItem({
      name: "Declined Thing",
      canonicalUnit: "ea",
      innerQuantity: 1,
      innerUnit: "ea",
    });
    await seedPurchase({ offerId, quantity: 5, lineTotal: 500, status: "declined" });

    assert.deepEqual(await paidCost(itemId), [], "a declined expense was never actually paid");
  });

  test("excludes lines with no usable quantity rather than dividing by zero", async () => {
    const { itemId, offerId } = await seedItem({
      name: "Quantityless",
      canonicalUnit: "ea",
      innerQuantity: 1,
      innerUnit: "ea",
    });
    await seedPurchase({ offerId, quantity: null, lineTotal: 100 });
    await seedPurchase({ offerId, quantity: 0, lineTotal: 100 });

    assert.deepEqual(await paidCost(itemId), []);
  });
});

describe("offer_unit_costs", () => {
  test("states a list price per base unit", async () => {
    const { offerId } = await seedItem({
      name: "Listed Eggs",
      canonicalUnit: "ea",
      innerQuantity: 30,
      innerUnit: "ea",
      packPrice: 60,
    });

    const cost = await scalar<string>(
      db,
      "select cost_per_base_unit from offer_unit_costs where offer_id = $1",
      [offerId]
    );
    assert.equal(Number(cost), 2.0);
  });

  test("converts to the base unit, so a 500 g pack is comparable with a 1 kg one", async () => {
    const small = await seedItem({
      name: "Rice 500g",
      canonicalUnit: "kg",
      innerQuantity: 500,
      innerUnit: "g",
      packPrice: 1.5,
    });
    const large = await seedItem({
      name: "Rice 1kg",
      canonicalUnit: "kg",
      innerQuantity: 1,
      innerUnit: "kg",
      packPrice: 2.8,
    });

    const smallCost = Number(
      await scalar<string>(db, "select cost_per_base_unit from offer_unit_costs where offer_id = $1", [
        small.offerId,
      ])
    );
    const largeCost = Number(
      await scalar<string>(db, "select cost_per_base_unit from offer_unit_costs where offer_id = $1", [
        large.offerId,
      ])
    );

    assert.equal(smallCost, 3.0, "$1.50 per 500 g is $3.00/kg");
    assert.equal(largeCost, 2.8);
    assert.ok(largeCost < smallCost, "the 1 kg pack is the cheaper one per kilogram");
  });

  test("leaves cost null rather than guessing when there is no price", async () => {
    const { offerId } = await seedItem({
      name: "Unpriced",
      canonicalUnit: "ea",
      innerQuantity: 1,
      innerUnit: "ea",
    });

    const cost = await scalar<string | null>(
      db,
      "select cost_per_base_unit from offer_unit_costs where offer_id = $1",
      [offerId]
    );
    assert.equal(cost, null);
  });
});

describe("item_unit_costs", () => {
  test("aggregates purchases, taking latest by receipt date", async () => {
    const { itemId, offerId } = await seedItem({
      name: "Aggregated Eggs",
      canonicalUnit: "ea",
      innerQuantity: 30,
      innerUnit: "ea",
      packPrice: 60,
    });

    // $2.00/egg in August, then $2.20/egg later that month
    await seedPurchase({ offerId, quantity: 12, lineTotal: 720, receiptDate: "2026-08-01" });
    await seedPurchase({ offerId, quantity: 6, lineTotal: 396, receiptDate: "2026-08-20" });

    const r = await db.query<Record<string, string>>(
      `select purchase_count, vendor_count, avg_cost_per_base_unit, min_cost_per_base_unit,
              max_cost_per_base_unit, latest_cost_per_base_unit, all_contents_confirmed
       from item_unit_costs where item_id = $1`,
      [itemId]
    );
    const row = r.rows[0];

    assert.equal(Number(row.purchase_count), 2);
    assert.equal(Number(row.vendor_count), 1);
    assert.equal(Number(row.avg_cost_per_base_unit), 2.1);
    assert.equal(Number(row.min_cost_per_base_unit), 2.0);
    assert.equal(Number(row.max_cost_per_base_unit), 2.2);
    assert.equal(
      Number(row.latest_cost_per_base_unit),
      2.2,
      "latest is by receipt date, not by insertion order"
    );
  });

  test("flags a figure resting on unconfirmed pack contents", async () => {
    // A placeholder created from a receipt: nobody has said what one unit
    // holds, so the arithmetic still runs but must not be stated as fact.
    const { itemId, offerId } = await seedItem({
      name: "Mystery Box",
      canonicalUnit: "ea",
      innerQuantity: 1,
      innerUnit: "ea",
      contentsConfirmed: false,
    });
    await seedPurchase({ offerId, quantity: 10, lineTotal: 100 });

    const confirmed = await scalar<boolean>(
      db,
      "select all_contents_confirmed from item_unit_costs where item_id = $1",
      [itemId]
    );
    assert.equal(confirmed, false);
  });
});

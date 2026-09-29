import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyMigration, createTestDb, scalar, type TestDb } from "./test-db.ts";
import { SETTING_DEFAULTS } from "./app-settings.ts";
import { loadCheapestRecent, loadPriceFlags, loadSpendFlags } from "./price-alerts-data.ts";

/**
 * Migration 0086: prices, and the price alerts, date a receipt by the day it
 * counts on (expenses.report_date, 0083) instead of working it out again in
 * UTC.
 *
 * The case that went wrong: a receipt with no date on it, submitted at 8:30
 * in the morning on the 1st in Sydney. It was still the day before in UTC, so
 * its offer's price was dated the 30th, and the price alerts put it in the
 * month before.
 */

/** 8:30am on 1 July in Sydney (AEST, +10), still 30 June in UTC. */
const EIGHT_THIRTY_ON_THE_FIRST = "2026-06-30T22:30:00Z";

type Ids = { profile: string; vendor: string; category: string; kg: string };
let seq = 0;

async function setUp(db: TestDb): Promise<Ids> {
  seq += 1;
  const profile = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data)
     values ($1, '{"full_name": "Price Dates"}'::jsonb) returning id`,
    [`price-dates-${seq}@test.local`]
  );
  const vendor = await addVendor(db);
  const category = await scalar<string>(db, "select id from categories where name = 'Miscellaneous'");
  const kg = await scalar<string>(db, "select id from units where code = 'kg'");
  return { profile, vendor, category, kg };
}

async function addVendor(db: TestDb): Promise<string> {
  seq += 1;
  return scalar<string>(db, "insert into vendors (name, status) values ($1, 'approved') returning id", [`Store ${seq}`]);
}

/** A 6 kg box, contents confirmed, and an offer on it at $price set at `setAt`. */
async function offer(db: TestDb, ids: Ids, price: number, setAt: string): Promise<{ offerId: string; itemId: string }> {
  seq += 1;
  const itemId = await scalar<string>(
    db,
    "insert into items (name, canonical_unit_id, category_id) values ($1, $2, $3) returning id",
    [`Price date test ${seq}`, ids.kg, ids.category]
  );
  const packId = await scalar<string>(
    db,
    `insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, contents_confirmed)
     values ($1, 6, $2, 1, true) returning id`,
    [itemId, ids.kg]
  );
  const offerId = await scalar<string>(
    db,
    `insert into pricelist_items (pack_size_id, vendor_id, pack_price, price_set_at, status)
     values ($1, $2, $3, $4, 'approved') returning id`,
    [packId, ids.vendor, price, setAt]
  );
  return { offerId, itemId };
}

/**
 * A receipt for one box of the offer at `price`, submitted at `submittedAt`
 * and priced onto the offer as submitting does. `receiptDate` null is a
 * receipt with no date on it.
 */
async function receipt(
  db: TestDb,
  ids: Ids,
  offerId: string,
  price: number,
  receiptDate: string | null,
  submittedAt: string
): Promise<string> {
  const expenseId = await scalar<string>(
    db,
    `insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri, created_at)
     values ($1, $2, 'submitted', $3, $4, 1448, $5) returning id`,
    [ids.profile, ids.vendor, receiptDate, price, submittedAt]
  );
  await db.query(
    `insert into expense_line_items (expense_id, pricelist_item_id, description_raw, kind, quantity, line_total)
     values ($1, $2, 'BOX 6KG', 'goods', 1, $3)`,
    [expenseId, offerId, price]
  );
  await db.query("select price_offers_from_expense($1)", [expenseId]);
  return expenseId;
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

/**
 * Just enough of supabase-js for price-alerts-data, answered by the test
 * database: plain column lists, and the filters those loaders use. PostgREST
 * sends dates and timestamps as text, so they come back as text here too.
 */
const AS_TEXT = { 1082: (x: string) => x, 1114: (x: string) => x, 1184: (x: string) => x };

type Result = { data: unknown[] | null; error: { message: string } | null };

function clientOn(db: TestDb): SupabaseClient {
  return {
    from(table: string) {
      let columns = "*";
      let orderBy = "";
      let limit = "";
      const where: string[] = [];
      const params: unknown[] = [];
      const param = (v: unknown) => (params.push(v), `$${params.length}`);
      const builder = {
        select(list: string) {
          assert.doesNotMatch(list, /[(!:]/, "only plain column lists");
          columns = list;
          return builder;
        },
        eq(column: string, value: unknown) {
          where.push(`${column}::text = ${param(String(value))}`);
          return builder;
        },
        in(column: string, values: unknown[]) {
          where.push(`${column}::text = any(${param(values.map(String))}::text[])`);
          return builder;
        },
        gte(column: string, value: string) {
          where.push(`${column} >= ${param(value)}`);
          return builder;
        },
        not(column: string, operator: string, list: string) {
          assert.equal(operator, "in");
          where.push(`not (${column}::text = any(${param(list.slice(1, -1).split(","))}::text[]))`);
          return builder;
        },
        order(column: string) {
          orderBy = ` order by ${column}`;
          return builder;
        },
        range(from: number, to: number) {
          limit = ` limit ${to - from + 1} offset ${from}`;
          return builder;
        },
        then<T>(resolve: (result: Result) => T, reject?: (error: unknown) => T) {
          const sql = `select ${columns} from ${table}${where.length ? ` where ${where.join(" and ")}` : ""}${orderBy}${limit}`;
          return db
            .query(sql, params, { parsers: AS_TEXT })
            .then(
              (r): Result => ({ data: r.rows as unknown[], error: null }),
              (e: Error): Result => ({ data: null, error: { message: e.message } })
            )
            .then(resolve, reject);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

let db: TestDb;
let ids: Ids;

before(async () => {
  db = await createTestDb();
  ids = await setUp(db);
});

after(async () => {
  await db?.close();
});

describe("0086: an offer's price is dated the day its receipt counts on", () => {
  test("an undated receipt submitted at 8:30 on the 1st dates its price the 1st", async () => {
    const { offerId } = await offer(db, ids, 75, "2026-06-15T00:00:00Z");
    await receipt(db, ids, offerId, 80, null, EIGHT_THIRTY_ON_THE_FIRST);

    assert.deepEqual(await priceOf(db, offerId), { price: 80, day: "2026-07-01", fromReceipt: true });
    const label = await scalar<string>(
      db,
      `select changes -> 'price_source' ->> 'new' from pricelist_item_history
       where item_id = $1 and changes ? 'price_source' order by changed_at desc limit 1`,
      [offerId]
    );
    assert.match(label, / of 01\/07\/2026$/);
  });

  test("…and isn't taken for older than a receipt of the 1st", async () => {
    // A receipt dated the 1st, submitted at 7am, then the undated one at 8:30.
    const { offerId } = await offer(db, ids, 75, "2026-06-15T00:00:00Z");
    await receipt(db, ids, offerId, 80, "2026-07-01", "2026-06-30T21:00:00Z");
    await receipt(db, ids, offerId, 85, null, EIGHT_THIRTY_ON_THE_FIRST);

    assert.deepEqual(await priceOf(db, offerId), { price: 85, day: "2026-07-01", fromReceipt: true });
  });

  test("a receipt of the 30th doesn't replace a price typed at 8:30 on the 1st", async () => {
    const { offerId } = await offer(db, ids, 75, EIGHT_THIRTY_ON_THE_FIRST);
    await receipt(db, ids, offerId, 70, "2026-06-30", "2026-07-01T02:00:00Z");

    assert.deepEqual(await priceOf(db, offerId), { price: 75, day: "2026-06-30", fromReceipt: false });
  });

  test("item_paid_unit_costs dates the purchase the 1st", async () => {
    const { offerId } = await offer(db, ids, 75, "2026-06-15T00:00:00Z");
    const expenseId = await receipt(db, ids, offerId, 80, null, EIGHT_THIRTY_ON_THE_FIRST);

    assert.equal(
      await scalar<string>(db, "select report_date::text from item_paid_unit_costs where expense_id = $1", [expenseId]),
      "2026-07-01"
    );
  });
});

describe("0086 re-dates offers already priced the day before", () => {
  test("an offer priced from an undated 8:30 receipt moves to the 1st; nothing else changes", async () => {
    const before086 = await createTestDb({ stopBefore: "0086_price_report_date.sql" });
    try {
      const old = await setUp(before086);
      const undated = await offer(before086, old, 75, "2026-06-15T00:00:00Z");
      await receipt(before086, old, undated.offerId, 80, null, EIGHT_THIRTY_ON_THE_FIRST);
      const dated = await offer(before086, old, 75, "2026-06-15T00:00:00Z");
      await receipt(before086, old, dated.offerId, 90, "2026-07-01", EIGHT_THIRTY_ON_THE_FIRST);
      const typed = await offer(before086, old, 60, EIGHT_THIRTY_ON_THE_FIRST);

      // As 0082 dated it: the day in UTC.
      assert.deepEqual(await priceOf(before086, undated.offerId), { price: 80, day: "2026-06-30", fromReceipt: true });
      const historyBefore = await scalar<number>(before086, "select count(*)::int from pricelist_item_history");

      await applyMigration(before086, "0086_price_report_date.sql");

      assert.deepEqual(await priceOf(before086, undated.offerId), { price: 80, day: "2026-07-01", fromReceipt: true });
      assert.deepEqual(await priceOf(before086, dated.offerId), { price: 90, day: "2026-07-01", fromReceipt: true });
      assert.deepEqual(await priceOf(before086, typed.offerId), { price: 60, day: "2026-06-30", fromReceipt: false });
      assert.equal(await scalar<number>(before086, "select count(*)::int from pricelist_item_history"), historyBefore);
    } finally {
      await before086.close();
    }
  });
});

describe("the price alerts read the same day", () => {
  const settings = { ...SETTING_DEFAULTS.price_alerts };

  test("the cheapest recent source counts an undated receipt from the window's first morning", async () => {
    const { offerId, itemId } = await offer(db, ids, 60, "2026-06-15T00:00:00Z");
    await receipt(db, ids, offerId, 30, null, EIGHT_THIRTY_ON_THE_FIRST); // $5/kg
    await receipt(db, ids, offerId, 60, "2026-07-10", "2026-07-10T02:00:00Z"); // $10/kg

    // Thirty days back from 31 July is 1 July.
    const found = await loadCheapestRecent(clientOn(db), 30, "2026-07-31", itemId);
    assert.deepEqual(found.get(itemId), { costPerUnit: 5, unit: "kg", vendorId: ids.vendor, date: "2026-07-01" });
  });

  test("a receipt of the 30th, entered later that morning, is the purchase before it", async () => {
    const { offerId } = await offer(db, ids, 48, "2026-06-15T00:00:00Z");
    const undated = await receipt(db, ids, offerId, 60, null, EIGHT_THIRTY_ON_THE_FIRST); // $10/kg
    await receipt(db, ids, offerId, 48, "2026-06-30", "2026-07-01T01:00:00Z"); // $8/kg, 11am on the 1st

    const flags = (await loadPriceFlags(clientOn(db), [undated], settings)).get(undated) ?? [];
    assert.equal(flags.length, 1);
    const [flag] = flags;
    assert.ok(flag?.kind === "rise", `expected a rise, got ${flag?.kind}`);
    assert.deepEqual(
      { from: flag.from, to: flag.to, percent: flag.percent, previousDate: flag.previousDate },
      { from: 8, to: 10, percent: 25, previousDate: "2026-06-30" }
    );
  });

  test("a vendor's year of spend starts on the day an undated receipt counts on", async () => {
    const vendor = await addVendor(db);
    const spend = (receiptDate: string | null, createdAt: string, total: number) =>
      scalar<string>(
        db,
        `insert into expenses (submitted_by, vendor_id, status, receipt_date, total, fiscal_year_hijri, created_at)
         values ($1, $2, 'paid', $3, $4, 1447, $5) returning id`,
        [ids.profile, vendor, receiptDate, total, createdAt]
      );
    // 8:30 on 1 July 2025 in Sydney: exactly a year before the expense below.
    await spend(null, "2025-06-30T22:30:00Z", 100);
    await spend("2025-12-01", "2025-12-01T02:00:00Z", 100);
    await spend("2026-03-01", "2026-03-01T02:00:00Z", 100);
    const big = await spend("2026-07-01", "2026-07-01T02:00:00Z", 1000);

    const row = (await db.query<{ id: string; vendor_id: string; total: string; report_date: string }>(
      "select id, vendor_id, total, report_date::text from expenses where id = $1",
      [big]
    )).rows[0]!;
    const found = await loadSpendFlags(clientOn(db), [row], { ...settings, spendMinHistory: 3 });
    assert.deepEqual(found.get(big), { multiple: 10, typical: 100, historyCount: 3 });
  });
});

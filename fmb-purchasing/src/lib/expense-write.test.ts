import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";

/**
 * create_expense_with_lines / update_expense_with_lines — migration 0031.
 *
 * Writing an expense used to be seven or more separate round trips: the parent
 * row, then a loop inserting line items one at a time, then the history row.
 * An interruption anywhere in that loop left an expense holding *some* of its
 * lines, with a total that no longer matched them and nothing to say so.
 *
 * Moving it into one function bought atomicity, a single round trip, and
 * somewhere to enforce the invariant the rest of the system now depends on:
 * the lines must account for the total. That check has to live here rather
 * than in the form alone, because the form is not the only thing that can
 * write an expense, and an invariant reporting relies on should not be
 * enforceable only by a well-behaved caller.
 */

let db: TestDb;
const ids = { profile: "", vendor: "", category: "" };

before(async () => {
  db = await createTestDb();
  ids.profile = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data)
     values ('writer@test.local', '{"full_name": "Writer Test"}'::jsonb)
     returning id`
  );
  ids.vendor = await scalar<string>(
    db,
    "insert into vendors (name, status) values ('Write Vendor', 'approved') returning id"
  );
  ids.category = await scalar<string>(db, "select id from categories where name = 'Miscellaneous'");
});

after(async () => {
  await db?.close();
});

type Line = {
  description_raw: string;
  line_total: number;
  kind?: string;
  gst_applicable?: boolean;
  line_gst?: number;
  line_subtotal?: number;
};

function lines(...rows: Line[]) {
  return JSON.stringify(
    rows.map((r) => ({
      pricelist_item_id: null,
      category_id: null,
      kind: r.kind ?? "goods",
      quantity: null,
      unit_price: null,
      line_subtotal: r.line_subtotal ?? r.line_total,
      line_gst: r.line_gst ?? 0,
      gst_applicable: r.gst_applicable ?? false,
      normalized_quantity: null,
      normalized_unit: null,
      description_raw: r.description_raw,
      line_total: r.line_total,
    }))
  );
}

async function create(total: number, linesJson: string, attachments = "[]") {
  return db.query<{ id: string; expense_number: string }>(
    `select * from create_expense_with_lines(
       $1, $2, 'Write Vendor', 'INV-1', '2026-07-02'::date,
       $3, 0, $4, null, null, 1448, $5::jsonb, $6::jsonb)`,
    [ids.profile, ids.vendor, total, total, linesJson, attachments]
  );
}

describe("create_expense_with_lines", () => {
  test("writes the expense, its lines and its history in one call", async () => {
    const result = await create(99.51, lines(
      { description_raw: "Penne Pasta 500g", line_total: 13.35 },
      { description_raw: "PeaCarrCorn 1kg", line_total: 86.16 }
    ));
    const id = result.rows[0]!.id;

    assert.match(result.rows[0]!.expense_number, /^E-\d{4}$/);
    assert.equal(await scalar<number>(db, "select count(*) from expense_line_items where expense_id = $1", [id]), 2);
    // The history row exists, so the audit trail starts at submission.
    assert.equal(
      await scalar<string>(db, "select to_status from expense_status_history where expense_id = $1", [id]),
      "submitted"
    );
  });

  test("refuses a receipt whose lines do not account for the total", async () => {
    // The Aldi case: two lines summing to 99.51 on a receipt charged 100.07
    // after a 56c card surcharge. Recording this silently was how a submitter
    // ended up 56c out of pocket.
    await assert.rejects(
      () => create(100.07, lines(
        { description_raw: "Penne Pasta 500g", line_total: 13.35 },
        { description_raw: "PeaCarrCorn 1kg", line_total: 86.16 }
      )),
      /Line items total .* but the receipt total is/
    );
  });

  test("accepts it once the surcharge is a line of its own", async () => {
    const result = await create(100.07, lines(
      { description_raw: "Penne Pasta 500g", line_total: 13.35 },
      { description_raw: "PeaCarrCorn 1kg", line_total: 86.16 },
      { description_raw: "Credit surcharge", line_total: 0.56, kind: "surcharge", gst_applicable: true, line_gst: 0.05, line_subtotal: 0.51 }
    ));
    assert.ok(result.rows[0]!.id);
  });

  test("a discount is a negative line, not a smaller total", async () => {
    // Radhe: SUBTOTAL 92.00 / 10% DISCOUNT 9.20- / TOTAL 82.80
    const result = await create(82.8, lines(
      { description_raw: "Saurmi Dal Urid Gota 2kg", line_total: 92.0 },
      { description_raw: "10% discount", line_total: -9.2, kind: "discount" }
    ));
    const id = result.rows[0]!.id;
    assert.equal(
      await scalar<number>(db, "select count(*) from expense_line_items where expense_id = $1 and kind = 'discount'", [id]),
      1
    );
  });

  test("nothing is written when the sum check fails", async () => {
    const before = await scalar<number>(db, "select count(*) from expenses");
    await assert.rejects(() => create(500, lines({ description_raw: "Meat", line_total: 100 })));
    // Atomicity is the whole point: a rejected write leaves no orphan parent.
    assert.equal(await scalar<number>(db, "select count(*) from expenses"), before);
  });

  test("refuses an expense with no lines at all", async () => {
    await assert.rejects(() => create(0, "[]"), /at least one line item/);
  });

  test("a one-cent difference is tolerated as float noise", async () => {
    const result = await create(10.0, lines(
      { description_raw: "a", line_total: 3.33 },
      { description_raw: "b", line_total: 3.33 },
      { description_raw: "c", line_total: 3.33 }
    ));
    assert.ok(result.rows[0]!.id);
  });

  test("five cents is a real difference and is refused", async () => {
    // Australian cash rounding prints as its own line and is captured as one,
    // so there is nothing legitimate for a wider tolerance to absorb.
    await assert.rejects(() => create(10.05, lines({ description_raw: "a", line_total: 10.0 })));
  });

  test("attachments ride along in the same transaction", async () => {
    const sha = "a".repeat(64);
    const result = await create(
      50,
      lines({ description_raw: "Goat", line_total: 50 }),
      JSON.stringify([
        { storage_path: `sha256/aa/${sha}.jpg`, file_name: "receipt.jpg", content_type: "image/jpeg", size_bytes: 1234, sha256: sha },
      ])
    );
    assert.equal(
      await scalar<string>(db, "select file_name from expense_attachments where expense_id = $1", [result.rows[0]!.id]),
      "receipt.jpg"
    );
  });
});

describe("update_expense_with_lines", () => {
  test("replaces the lines and keeps the sum check", async () => {
    const created = await create(50, lines({ description_raw: "Goat", line_total: 50 }));
    const id = created.rows[0]!.id;

    await db.query(
      `select update_expense_with_lines(
         $1, $2, $3, 'Write Vendor', 'INV-1', '2026-07-02'::date,
         75, 0, 75, null, null, 1448, $4::jsonb, '[]'::jsonb)`,
      [id, ids.profile, ids.vendor, lines(
        { description_raw: "Goat", line_total: 50 },
        { description_raw: "Lamb", line_total: 25 }
      )]
    );

    assert.equal(await scalar<number>(db, "select count(*) from expense_line_items where expense_id = $1", [id]), 2);
    assert.equal(await scalar<string>(db, "select total::text from expenses where id = $1", [id]), "75.00");
  });

  test("refuses an edit by someone who does not own the expense", async () => {
    const created = await create(50, lines({ description_raw: "Goat", line_total: 50 }));
    const stranger = await scalar<string>(
      db,
      `insert into auth.users (email, raw_user_meta_data)
       values ('stranger${Date.now()}@test.local', '{"full_name": "Stranger"}'::jsonb) returning id`
    );
    await assert.rejects(
      () =>
        db.query(
          `select update_expense_with_lines($1, $2, $3, 'x', null, null, 50, 0, 50, null, null, 1448, $4::jsonb, '[]'::jsonb)`,
          [created.rows[0]!.id, stranger, ids.vendor, lines({ description_raw: "Goat", line_total: 50 })]
        ),
      /belongs to someone else/
    );
  });

  test("refuses an edit once the expense has been decided", async () => {
    const created = await create(50, lines({ description_raw: "Goat", line_total: 50 }));
    const id = created.rows[0]!.id;
    await db.query("update expenses set status = 'approved' where id = $1", [id]);

    // Closes the window between an approver deciding and a submitter saving an
    // edit they had opened beforehand.
    await assert.rejects(
      () =>
        db.query(
          `select update_expense_with_lines($1, $2, $3, 'x', null, null, 50, 0, 50, null, null, 1448, $4::jsonb, '[]'::jsonb)`,
          [id, ids.profile, ids.vendor, lines({ description_raw: "Goat", line_total: 50 })]
        ),
      /can no longer be edited/
    );
  });
});

describe("charge lines and per-unit costing", () => {
  test("a surcharge never reaches the per-unit cost view", async () => {
    const result = await create(100.56, lines(
      { description_raw: "Chicken", line_total: 100 },
      { description_raw: "Credit surcharge", line_total: 0.56, kind: "surcharge" }
    ));
    // The charge has no pricelist item and no quantity, and kind excludes it
    // outright — so a delivery fee can never land in a $/kg trend.
    const inCosting = await scalar<number>(
      db,
      "select count(*) from item_paid_unit_costs where expense_id = $1",
      [result.rows[0]!.id]
    );
    assert.equal(inCosting, 0);
  });
});

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "./test-db.ts";
import { buildAbaFile } from "./aba.ts";
import { buildXeroBillsCsv } from "./xero-export.ts";
import { sumLineGst } from "./expense-money.ts";
import type { StoredLineKind } from "./line-kinds.ts";

/**
 * One expense from submission to payment and back, through every migration
 * at once (scratchpad #46).
 *
 * The other suites test each step on its own. This walks the path a real
 * receipt takes — submitted with its lines and receipt, approved, paid in a
 * run, turned into a bank file and a Xero bills row, then the payment
 * reversed — so a change that breaks the hand-off between two steps, which no
 * single-step test can see, fails here.
 *
 * It runs against the database the migrations build, not the pages: the
 * pages need a signed-in browser, which is what the sandbox (#1) is for.
 */

let db: TestDb;
const ids = {
  submitter: "",
  approver: "",
  payer: "",
  vendor: "",
  payee: "",
  category: "",
  item: "",
  offer: "",
};

before(async () => {
  db = await createTestDb();
  const person = (email: string, name: string) =>
    scalar<string>(db, `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`, [
      email,
      JSON.stringify({ full_name: name }),
    ]);
  ids.submitter = await person("submitter@e2e.local", "Submitter");
  ids.approver = await person("approver@e2e.local", "Approver");
  ids.payer = await person("payer@e2e.local", "Payer");

  ids.vendor = await scalar<string>(
    db,
    "insert into vendors (name, abn, status) values ('Fresh Poultry', '65620358429', 'approved') returning id"
  );
  ids.payee = await scalar<string>(
    db,
    `insert into payees (display_name, vendor_id, bank_account_name, bank_bsb, bank_account_number, status)
     values ('Fresh Poultry', $1, 'FRESH POULTRY PTY LTD', '062000', '12345678', 'approved') returning id`,
    [ids.vendor]
  );
  ids.category = await scalar<string>(db, "select id from categories where name = 'Miscellaneous'");
  await db.query("update categories set account_code = '420' where id = $1", [ids.category]);

  const kg = await scalar<string>(db, "select id from units where code = 'kg'");
  ids.item = await scalar<string>(
    db,
    "insert into items (name, canonical_unit_id, category_id) values ('Chicken Thigh', $1, $2) returning id",
    [kg, ids.category]
  );
  const pack = await scalar<string>(
    db,
    `insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, contents_confirmed)
     values ($1, 10, $2, 1, true) returning id`,
    [ids.item, kg]
  );
  ids.offer = await scalar<string>(
    db,
    "insert into pricelist_items (pack_size_id, vendor_id, pack_price, status) values ($1, $2, 72, 'approved') returning id",
    [pack, ids.vendor]
  );
});

after(async () => {
  await db?.close();
});

test("a receipt goes from submitted to paid, into a bank file and Xero, and back", async () => {
  // ---- Submitted: two boxes of chicken, and a delivery charge with GST.
  const lines = [
    {
      pricelist_item_id: ids.offer,
      category_id: ids.category,
      kind: "goods",
      quantity: 2,
      unit_price: 72,
      line_subtotal: 144,
      line_gst: 0,
      gst_applicable: false,
      normalized_quantity: 2,
      normalized_unit: null,
      description_raw: "Chicken thigh fillet 10kg",
      line_total: 144,
    },
    {
      pricelist_item_id: null,
      category_id: ids.category,
      kind: "delivery",
      quantity: null,
      unit_price: null,
      line_subtotal: 10,
      line_gst: 1,
      gst_applicable: true,
      normalized_quantity: null,
      normalized_unit: null,
      description_raw: "Delivery",
      line_total: 11,
    },
  ];
  const gst = sumLineGst(
    lines.map((l) => ({ kind: l.kind as StoredLineKind, lineTotal: l.line_total, gstApplicable: l.gst_applicable }))
  );
  assert.equal(gst, 1);

  const created = await db.query<{ id: string; expense_number: string }>(
    `select * from create_expense_with_lines(
       $1, $2, 'Fresh Poultry', 'INV-433964', '2026-09-08'::date,
       154, $3, 155, 'Weekly chicken', $4, 1448, $5::jsonb, $6::jsonb, 1)`,
    [
      ids.submitter,
      ids.vendor,
      gst,
      ids.payee,
      JSON.stringify(lines),
      JSON.stringify([
        { storage_path: `sha256/ab/${"ab".repeat(32)}.jpg`, file_name: "receipt.jpg", content_type: "image/jpeg", size_bytes: 1234, sha256: "ab".repeat(32) },
      ]),
    ]
  );
  const expense = created.rows[0];
  assert.match(expense.expense_number, /\S/);
  assert.equal(await scalar(db, "select status::text from expenses where id = $1", [expense.id]), "submitted");

  // The purchase is already costed per kg: two 10 kg boxes for $144.
  const perKg = await scalar<string>(db, "select cost_per_base_unit::text from item_paid_unit_costs where expense_id = $1", [
    expense.id,
  ]);
  assert.equal(Number(perKg), 7.2);

  // ---- Approved.
  const decided = await db.query("select * from decide_expenses($1::uuid[], $2, 'approved', 'Checked')", [
    [expense.id],
    ids.approver,
  ]);
  assert.equal(decided.rows.length, 1);
  assert.equal(await scalar(db, "select status::text from expenses where id = $1", [expense.id]), "approved");

  // Once decided, its receipt is kept (0055).
  await assert.rejects(db.query("delete from expense_attachments where expense_id = $1", [expense.id]), /five years/);

  // ---- Paid, in a run of its own.
  const paid = await db.query<{ run_id: string | null; total: string }>(
    "select * from pay_expenses($1::uuid[], $2, '2026-09-10', 'FMB-0910', null)",
    [[expense.id], ids.payer]
  );
  assert.equal(paid.rows.length, 1);
  assert.ok(paid.rows[0].run_id, "a single payee's payment makes a run");
  assert.equal(await scalar(db, "select status::text from expenses where id = $1", [expense.id]), "paid");

  const statuses = (
    await db.query<{ to_status: string }>(
      "select to_status::text from expense_status_history where expense_id = $1 order by created_at, to_status",
      [expense.id]
    )
  ).rows.map((r) => r.to_status);
  assert.deepEqual([...new Set(statuses)].sort(), ["approved", "paid", "submitted"]);

  // ---- The bank file for that payment.
  const account = (
    await db.query<{ bank_bsb: string; bank_account_number: string; bank_account_name: string }>(
      "select bank_bsb, bank_account_number, bank_account_name from payees where id = $1",
      [ids.payee]
    )
  ).rows[0];
  const aba = buildAbaFile(
    {
      bankAbbreviation: "CBA",
      userName: "FMB SYDNEY",
      userId: "123456",
      bsb: "062001",
      accountNumber: "87654321",
      remitterName: "FMB SYDNEY",
      description: "PAYMENTS",
      balancing: false,
    },
    [
      {
        bsb: account.bank_bsb,
        accountNumber: account.bank_account_number,
        accountName: account.bank_account_name,
        amountCents: Math.round(Number(paid.rows[0].total) * 100),
        reference: expense.expense_number,
      },
    ],
    "2026-09-10"
  );
  const records = aba.split(/\r\n/).filter(Boolean);
  assert.equal(records.length, 3, "a header, one payment and a total");
  assert.ok(records.every((r) => r.length === 120), "every ABA record is 120 characters");
  assert.ok(records[1].includes("0000015500"), "the payment line carries $155.00");

  // ---- The Xero bills row for each line.
  const csv = buildXeroBillsCsv(
    lines.map((l) => ({
      expenseNumber: expense.expense_number,
      invoiceNumber: "INV-433964",
      contactName: "Fresh Poultry",
      invoiceDate: "2026-09-08",
      dueDate: "2026-09-10",
      description: l.description_raw,
      lineTotal: l.line_total,
      gst: l.line_gst,
      isCapital: false,
      accountCode: "420",
    }))
  );
  const rows = csv.trim().split(/\r?\n/);
  assert.equal(rows.length, 3, "headings and two lines");
  assert.ok(rows[1].includes("EXEMPTEXPENSES") && rows[2].includes("INPUT"), "GST-free and taxable lines are told apart");

  // ---- Reversed: back to approved, with the reason on record.
  await db.query("select reverse_payment($1, $2, 'Bank returned the transfer')", [expense.id, ids.payer]);
  assert.equal(await scalar(db, "select status::text from expenses where id = $1", [expense.id]), "approved");
  const reversal = await scalar<string>(
    db,
    "select comment from expense_status_history where expense_id = $1 and is_reversal order by created_at desc limit 1",
    [expense.id]
  );
  assert.equal(reversal, "Bank returned the transfer");

  // ---- Paid again, then the quarter is lodged: it can no longer be reversed.
  await db.query("select * from pay_expenses($1::uuid[], $2, '2026-09-11', 'FMB-0911', null)", [[expense.id], ids.payer]);
  await db.query("insert into locked_periods (start_date, end_date, label) values ('2026-07-01', '2026-09-30', 'Q1')");
  await assert.rejects(db.query("select reverse_payment($1, $2, 'Too late')", [expense.id, ids.payer]));
});

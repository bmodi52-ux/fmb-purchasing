import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, scalar, type TestDb } from "../test-db.ts";
import { summariseGst, xeroTaxType } from "../gst-summary.ts";
import { budgetActuals } from "../budget-actuals.ts";
import { applyFilters, byCategory, byMonth, byStatus, byVendor, totals, NO_FILTERS } from "./aggregate.ts";
import { withStatusBasis } from "./basis.ts";
import { accountingFromLedger } from "./accounting.ts";
import {
  EXPENSE_COLUMNS,
  LINE_COLUMNS,
  UNIT_COST_COLUMNS,
  concatRows,
  monthsCovering,
  normaliseLedger,
  type Dimensions,
  type Ledger,
  type PaidCostRow,
  type RawExpenseRow,
  type RawLedgerRows,
  type RawLineRow,
} from "./ledger-rows.ts";
import { averageUnitCosts, perUnitRows } from "./unit-costs.ts";

/**
 * Every report reconciles with the records it is built from, and with every
 * other report — tested against Postgres itself.
 *
 * The expenses here are written through the app's own functions
 * (create_expense_with_lines, decide_expenses, pay_expenses), so the rules the
 * database enforces are part of what is tested. They are read back the way
 * the loader reads them: the same column lists, serialised to JSON as
 * PostgREST serialises them. Then the ledger is built exactly as in
 * production, and each report's figures are checked against the table sums
 * and against each other.
 *
 * The ledger holds one of everything the audit found a report getting wrong:
 * every status; a discount carrying negative GST; a capital purchase; a line
 * filed on a parent category; an undated receipt submitted early on the 1st;
 * a charge not on the receipt; and a pack whose contents disagree with the
 * receipt.
 */

let db: TestDb;
const ids = {
  submitter: "",
  approver: "",
  payee: "",
  vendor: "",
  parentCategory: "",
  childCategory: "",
  capitalCategory: "",
  goodOffer: "",
  disputedOffer: "",
  item: "",
};
const expense = { paidJuly: "", approvedJuly: "", undatedFirst: "", declined: "", withdrawn: "", paidAugust: "" };

async function write(opts: {
  receiptDate: string | null;
  vendorId?: string | null;
  vendorRaw: string;
  lines: Record<string, unknown>[];
}): Promise<string> {
  const total = Math.round(opts.lines.reduce((s, l) => s + Number(l.line_total), 0) * 100) / 100;
  const gst = Math.round(opts.lines.reduce((s, l) => s + Number(l.line_gst ?? 0), 0) * 100) / 100;
  return scalar<string>(
    db,
    `select id from create_expense_with_lines(
       $1, $2, $3, null, $4::date, $5, $6, $7, null, $8, 1448, $9::jsonb)`,
    [ids.submitter, opts.vendorId ?? null, opts.vendorRaw, opts.receiptDate, total - gst, gst, total, ids.payee, JSON.stringify(opts.lines)]
  );
}

before(async () => {
  db = await createTestDb();

  ids.submitter = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data) values ('recon-submit@test.local', '{"full_name": "Submitter"}'::jsonb) returning id`
  );
  ids.approver = await scalar<string>(
    db,
    `insert into auth.users (email, raw_user_meta_data) values ('recon-approve@test.local', '{"full_name": "Approver"}'::jsonb) returning id`
  );
  ids.payee = await scalar<string>(db, "insert into payees (display_name) values ('Recon Payee') returning id");
  ids.vendor = await scalar<string>(db, "insert into vendors (name, status) values ('Fresh Poultry', 'approved') returning id");

  const tree = await db.query<{ parent: string; child: string }>(
    `select p.id as parent, c.id as child from categories c join categories p on p.id = c.parent_category_id order by p.name, c.name limit 1`
  );
  ids.parentCategory = tree.rows[0].parent;
  ids.childCategory = tree.rows[0].child;
  ids.capitalCategory = await scalar<string>(db, "select id from categories where capital_purchases limit 1");

  const kg = await scalar<string>(db, "select id from units where code = 'kg'");
  ids.item = await scalar<string>(
    db,
    "insert into items (name, canonical_unit_id, category_id) values ('Chicken thigh', $1, $2) returning id",
    [kg, ids.childCategory]
  );
  const pack = await scalar<string>(
    db,
    `insert into item_pack_sizes (item_id, inner_quantity, inner_unit_id, pack_count, label, sold_loose, contents_confirmed)
     values ($1, 1, $2, 1, '1kg tray', false, true) returning id`,
    [ids.item, kg]
  );
  ids.goodOffer = await scalar<string>(
    db,
    "insert into pricelist_items (pack_size_id, vendor_id, pack_price, status) values ($1, $2, 12, 'approved') returning id",
    [pack, ids.vendor]
  );
  ids.disputedOffer = ids.goodOffer;

  // Paid in July: chicken, a discount off taxable goods, a card surcharge.
  expense.paidJuly = await write({
    receiptDate: "2026-07-05",
    vendorId: ids.vendor,
    vendorRaw: "FRESH POULTRY PTY LTD",
    lines: [
      { description_raw: "Chicken thigh 1kg", kind: "goods", category_id: ids.childCategory, pricelist_item_id: ids.goodOffer, quantity: 2, normalized_quantity: 2, normalized_unit: "kg", line_subtotal: 24, line_gst: 0, line_total: 24, gst_applicable: false },
      { description_raw: "Promo discount", kind: "discount", line_subtotal: -15, line_gst: -1.5, line_total: -16.5, gst_applicable: true },
      { description_raw: "Card surcharge", kind: "surcharge", line_subtotal: 2, line_gst: 0.2, line_total: 2.2, gst_applicable: true },
      { description_raw: "Cleaning spray", kind: "goods", category_id: ids.childCategory, line_subtotal: 100, line_gst: 10, line_total: 110, gst_applicable: true },
    ],
  });

  // Approved in July: a combi oven (capital), and meat filed on the parent category itself.
  expense.approvedJuly = await write({
    receiptDate: "2026-07-20",
    vendorRaw: "Equipment Co",
    lines: [
      { description_raw: "Combi oven", kind: "goods", category_id: ids.capitalCategory, line_subtotal: 8000, line_gst: 800, line_total: 8800, gst_applicable: true, is_capital: true },
      { description_raw: "Assorted meat", kind: "goods", category_id: ids.parentCategory, line_subtotal: 5760, line_gst: 0, line_total: 5760, gst_applicable: false },
    ],
  });

  // Submitted with no receipt date at 8:30am on 1 July in Sydney (still 30 June
  // in UTC), including a pack the receipt says was twenty times larger.
  expense.undatedFirst = await write({
    receiptDate: null,
    vendorId: ids.vendor,
    vendorRaw: "Fresh Poultry",
    lines: [
      { description_raw: "Chicken thigh", kind: "goods", category_id: ids.childCategory, pricelist_item_id: ids.disputedOffer, quantity: 1, normalized_quantity: 20, normalized_unit: "kg", line_subtotal: 180, line_gst: 0, line_total: 180, gst_applicable: false },
    ],
  });
  await db.query("update expenses set created_at = '2026-06-30T22:30:00Z' where id = $1", [expense.undatedFirst]);

  // Declined and withdrawn: records, not spend.
  expense.declined = await write({
    receiptDate: "2026-07-10",
    vendorRaw: "Declined Shop",
    lines: [{ description_raw: "Nope", kind: "goods", line_subtotal: 50, line_gst: 0, line_total: 50, gst_applicable: false }],
  });
  expense.withdrawn = await write({
    receiptDate: "2026-07-11",
    vendorRaw: "Withdrawn Shop",
    lines: [{ description_raw: "Taken back", kind: "goods", line_subtotal: 60, line_gst: 0, line_total: 60, gst_applicable: false }],
  });

  // Paid in September for an August receipt, with a charge added that isn't on it.
  expense.paidAugust = await write({
    receiptDate: "2026-08-02",
    vendorId: ids.vendor,
    vendorRaw: "Fresh Poultry",
    lines: [
      { description_raw: "Whole chickens", kind: "goods", category_id: ids.childCategory, line_subtotal: 990, line_gst: 0, line_total: 990, gst_applicable: false },
      { description_raw: "Clean and cut", kind: "service", line_subtotal: 150, line_gst: 0, line_total: 150, gst_applicable: false, not_on_receipt: true, not_on_receipt_note: "Added at the counter" },
    ],
  });

  await db.query("select * from decide_expenses($1::uuid[], $2, 'approved', null)", [
    [expense.paidJuly, expense.approvedJuly, expense.paidAugust],
    ids.approver,
  ]);
  await db.query("select * from decide_expenses($1::uuid[], $2, 'declined', 'Not ours')", [[expense.declined], ids.approver]);
  await db.query("update expenses set status = 'withdrawn' where id = $1", [expense.withdrawn]);
  await db.query("select * from pay_expenses($1::uuid[], $2, '2026-07-06', 'REF-1', null)", [[expense.paidJuly], ids.approver]);
  await db.query("select * from pay_expenses($1::uuid[], $2, '2026-09-01', 'REF-2', null)", [[expense.paidAugust], ids.approver]);
});

after(async () => {
  await db?.close();
});

/* ------------------------------------------------------------------ */
/* Reading it back the way the loader does                             */
/* ------------------------------------------------------------------ */

/** Rows as PostgREST would send them: JSON, from the loader's own column lists. */
async function jsonRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<{ row: T }>(`select to_jsonb(r) as row from (${sql}) r`, params);
  return result.rows.map((r) => r.row);
}

async function rowsFor(expenseSql: string, params: unknown[]): Promise<RawLedgerRows> {
  const expenses = await jsonRows<RawExpenseRow>(`select ${EXPENSE_COLUMNS} from expenses where ${expenseSql} order by id`, params);
  const expenseIds = expenses.map((e) => e.id);
  const lines = await jsonRows<RawLineRow>(
    `select ${LINE_COLUMNS.split(", ").map((c) => `l.${c}`).join(", ")}, i.id as item_id, i.name as item_name
     from expense_line_items l
     left join pricelist_items o on o.id = l.pricelist_item_id
     left join item_pack_sizes p on p.id = o.pack_size_id
     left join items i on i.id = p.item_id
     where l.expense_id = any($1::uuid[]) order by l.id`,
    [expenseIds]
  );
  const unitCosts = await jsonRows<PaidCostRow>(
    `select ${UNIT_COST_COLUMNS} from item_paid_unit_costs where expense_id = any($1::uuid[]) order by line_item_id`,
    [expenseIds]
  );
  return { expenses, lines, unitCosts };
}

async function dimensions(): Promise<Dimensions> {
  return {
    categories: await jsonRows("select id, name, parent_category_id, account_code from categories"),
    vendors: await jsonRows("select id, name from vendors"),
  };
}

/** loadLedger, less the cache: a month at a time, by report_date, spend statuses only. */
async function ledgerFor(start: string, end: string): Promise<Ledger> {
  const months = await Promise.all(
    monthsCovering({ start, end }).map((m) =>
      rowsFor("report_date between $1 and $2 and status not in ('declined', 'withdrawn')", [m.start, m.end])
    )
  );
  const ledger = normaliseLedger(concatRows(months), await dimensions());
  const inRange = ledger.expenses.filter((e) => e.reportDate >= start && e.reportDate <= end).map((e) => e.id);
  const keep = new Set(inRange);
  return {
    expenses: ledger.expenses.filter((e) => keep.has(e.id)),
    lines: ledger.lines.filter((l) => keep.has(l.expenseId)),
    unitCosts: ledger.unitCosts.filter((c) => keep.has(c.expense_id)),
  };
}

/** loadLedgerByPaymentDate, less the network. */
async function ledgerPaidBetween(start: string, end: string): Promise<Ledger> {
  return normaliseLedger(
    await rowsFor("status = 'paid' and payment_date between $1 and $2", [start, end]),
    await dimensions()
  );
}

const sumOf = async (sql: string, params: unknown[] = []) => Number(await scalar(db, sql, params));
const cents = (n: number) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ */

describe("the ledger", () => {
  test("holds exactly the spend: nothing declined or withdrawn", async () => {
    const ledger = await ledgerFor("2026-07-01", "2026-09-30");
    assert.deepEqual(
      new Set(ledger.expenses.map((e) => e.id)),
      new Set([expense.paidJuly, expense.approvedJuly, expense.undatedFirst, expense.paidAugust])
    );
  });

  test("dates the undated receipt on the Sydney day it was submitted", async () => {
    const ledger = await ledgerFor("2026-07-01", "2026-07-31");
    assert.equal(ledger.expenses.find((e) => e.id === expense.undatedFirst)?.reportDate, "2026-07-01");
    assert.equal((await ledgerFor("2026-06-01", "2026-06-30")).expenses.length, 0);
  });

  test("loaded a month at a time, is the same ledger as loaded at once", async () => {
    const monthly = await ledgerFor("2026-07-01", "2026-08-31");
    const whole = normaliseLedger(
      await rowsFor("report_date between $1 and $2 and status not in ('declined', 'withdrawn')", ["2026-07-01", "2026-08-31"]),
      await dimensions()
    );
    assert.deepEqual(new Set(monthly.lines.map((l) => l.id)), new Set(whole.lines.map((l) => l.id)));
    assert.equal(monthly.unitCosts.length, whole.unitCosts.length);
  });

  test("names a vendor by its record, not by what the receipt printed", async () => {
    const ledger = await ledgerFor("2026-07-01", "2026-07-31");
    assert.equal(ledger.expenses.find((e) => e.id === expense.paidJuly)?.vendorName, "Fresh Poultry");
    assert.equal(ledger.expenses.find((e) => e.id === expense.approvedJuly)?.vendorName, "Equipment Co");
  });
});

describe("Reports reconciles with the expenses table", () => {
  test("spend, and every way of cutting it, adds up to the expense totals", async () => {
    const ledger = await ledgerFor("2026-07-01", "2026-09-30");
    const slice = applyFilters(ledger.expenses, ledger.lines, NO_FILTERS);
    const expected = await sumOf(
      "select sum(total) from expenses where status not in ('declined', 'withdrawn') and report_date between '2026-07-01' and '2026-09-30'"
    );

    const spend = totals(slice).spend;
    assert.equal(spend, expected);
    for (const buckets of [byCategory(slice), byVendor(slice), byMonth(slice), byStatus(slice)]) {
      assert.equal(cents(buckets.reduce((s, b) => s + b.spend, 0)), expected);
    }
  });

  test("GST on the Reports page is the GST on the lines", async () => {
    const ledger = await ledgerFor("2026-07-01", "2026-09-30");
    const expected = await sumOf(
      `select sum(l.line_gst) from expense_line_items l join expenses e on e.id = l.expense_id
       where e.status not in ('declined', 'withdrawn') and e.report_date between '2026-07-01' and '2026-09-30'`
    );
    assert.equal(totals(applyFilters(ledger.expenses, ledger.lines, NO_FILTERS)).gst, expected);
  });

  test("counting only approved and paid drops exactly what is still waiting", async () => {
    const ledger = await ledgerFor("2026-07-01", "2026-09-30");
    const all = totals(applyFilters(ledger.expenses, ledger.lines, NO_FILTERS)).spend;
    const approved = withStatusBasis(ledger, "accrued");
    const waiting = await sumOf("select total from expenses where id = $1", [expense.undatedFirst]);
    assert.equal(cents(all - totals(applyFilters(approved.expenses, approved.lines, NO_FILTERS)).spend), waiting);
  });
});

describe("Accounting reconciles with Reports and with the Xero file", () => {
  const extras = {
    withReceipt: new Set<string>(),
    vendors: new Map(),
    locks: [],
    accountCodeByCategory: new Map<string, string | null>(),
  };

  test("G10 + G11 is Reports' approved-and-paid spend, and 1B its GST", async () => {
    const ledger = withStatusBasis(await ledgerFor("2026-07-01", "2026-09-30"), "accrued");
    const { gstExpenses, gstLines } = accountingFromLedger(ledger, extras);
    const gst = summariseGst(gstExpenses, gstLines);
    const slice = applyFilters(ledger.expenses, ledger.lines, NO_FILTERS);

    assert.equal(cents(gst.g10 + gst.g11), totals(slice).spend);
    assert.equal(gst.oneB, totals(slice).gst);
    assert.equal(gst.g10, 8800, "the combi oven, and nothing else, is capital");
  });

  test("the GST Xero will work out from the bills file is 1B, discount and all", async () => {
    const ledger = withStatusBasis(await ledgerFor("2026-07-01", "2026-09-30"), "accrued");
    const { gstExpenses, gstLines, xeroLines } = accountingFromLedger(ledger, extras);
    const xeroGst = cents(
      xeroLines.reduce((s, l) => s + (xeroTaxType(l).endsWith("INPUT") ? cents(l.lineTotal / 11) : 0), 0)
    );
    assert.equal(xeroGst, summariseGst(gstExpenses, gstLines).oneB);
  });

  test("the cash basis counts what was paid in the period, whenever its receipt was dated", async () => {
    const september = await ledgerPaidBetween("2026-09-01", "2026-09-30");
    assert.deepEqual(september.expenses.map((e) => e.id), [expense.paidAugust]);
    const { gstExpenses, gstLines } = accountingFromLedger(september, extras);
    const gst = summariseGst(gstExpenses, gstLines);
    assert.equal(cents(gst.g10 + gst.g11), await sumOf("select total from expenses where id = $1", [expense.paidAugust]));
  });
});

describe("Budgets reconciles with Reports", () => {
  test("leaf categories, parent categories and uncategorised spend add up to total spend", async () => {
    const ledger = await ledgerFor("2026-07-01", "2026-09-30");
    const actuals = budgetActuals(
      ledger.lines,
      new Map(ledger.expenses.map((e) => [e.id, e.status])),
      (await dimensions()).categories
    );
    const leaves = [...actuals.byLeaf.values()].reduce((s, l) => s + l.spent, 0);
    const parents = actuals.onParentCategories.reduce((s, p) => s + p.amount, 0);

    assert.equal(cents(leaves + parents + actuals.uncategorised), totals(applyFilters(ledger.expenses, ledger.lines, NO_FILTERS)).spend);
    assert.deepEqual(actuals.onParentCategories, [{ categoryId: ids.parentCategory, amount: 5760 }]);
  });
});

describe("Unit costs agree with the costing views", () => {
  test("the disputed pack is listed but left out of the average", async () => {
    const ledger = await ledgerFor("2026-07-01", "2026-09-30");
    const slice = applyFilters(ledger.expenses, ledger.lines, NO_FILTERS);
    const rows = perUnitRows(ledger.unitCosts, slice, () => true);
    assert.equal(rows.filter((r) => r.disputed).length, 1);

    const average = averageUnitCosts(ledger.unitCosts, slice, () => true).get(ids.item)!;
    const fromView = await sumOf(
      "select avg_cost_per_base_unit from item_unit_costs where item_id = $1",
      [ids.item]
    );
    // One undisputed purchase: 2kg for $24. The weighted average and the
    // Pricelist's view agree on it.
    assert.equal(average.purchases, 1);
    assert.equal(average.average, 12);
    assert.equal(fromView, 12);
  });
});

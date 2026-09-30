import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { documentToCsv } from "./tables.ts";
import {
  EXCEPTION_CHECKS,
  exceptionTables,
  findExceptions,
  type ExceptionExpense,
  type ExceptionLine,
  type ExceptionsInput,
} from "./exceptions.ts";

const RANGE = { start: "2026-07-01", end: "2026-09-30" };

let n = 0;
function expense(over: Partial<ExceptionExpense> = {}): ExceptionExpense {
  n += 1;
  return {
    id: `e${n}`,
    entry: `E-${String(n).padStart(4, "0")}`,
    vendor: "Harris Farm",
    status: "approved",
    reportDate: "2026-07-15",
    total: 110,
    gst: 10,
    gstPrinted: null,
    receiptTotal: null,
    receiptTotalScanned: null,
    receiptTotalNote: null,
    ...over,
  };
}

function line(expenseId: string, over: Partial<ExceptionLine> = {}): ExceptionLine {
  n += 1;
  return {
    id: `l${n}`,
    expenseId,
    kind: "goods",
    description: "Chicken thigh",
    lineTotal: 110,
    gst: 10,
    gstApplicable: true,
    notOnReceipt: false,
    notOnReceiptNote: null,
    categoryId: "meat",
    ...over,
  };
}

const CATEGORIES = [
  { id: "food", name: "Food", parent_category_id: null },
  { id: "meat", name: "Meat", parent_category_id: "food" },
];

function run(over: Partial<ExceptionsInput>) {
  return findExceptions({
    range: RANGE,
    expenses: [],
    lines: [],
    categories: CATEGORIES,
    disputedPacks: [],
    dateConcerns: [],
    duplicates: new Map(),
    ...over,
  });
}
const group = (r: ReturnType<typeof run>, kind: string) => r.groups.find((g) => g.kind === kind)!;

describe("findExceptions", () => {
  test("a clean expense raises nothing, and every check is still listed", () => {
    const e = expense({ receiptTotal: 110, gstPrinted: 10 });
    const r = run({ expenses: [e], lines: [line(e.id)] });
    assert.equal(r.flaggedExpenses, 0);
    assert.equal(r.groups.length, EXCEPTION_CHECKS.length);
    assert.ok(r.groups.every((g) => g.rows.length === 0));
  });

  test("a receipt whose lines don't reach its total, and a line claimed beyond it", () => {
    const e = expense({ total: 140, receiptTotal: 100 });
    const r = run({
      expenses: [e],
      lines: [
        line(e.id, { lineTotal: 90 }),
        line(e.id, { lineTotal: 50, notOnReceipt: true, notOnReceiptNote: "Clean and cut", description: "Labour" }),
      ],
    });
    const gap = group(r, "receipt_gap");
    assert.equal(gap.rows.length, 1);
    assert.equal(gap.rows[0].amount, 10);
    const off = group(r, "off_receipt");
    assert.equal(off.rows[0].amount, 50);
    assert.equal(off.rows[0].detail, "Labour — Clean and cut");
    assert.equal(r.flaggedExpenses, 1);
    assert.equal(r.flaggedSpend, 140);
  });

  test("an expense from before receipt totals were kept raises no receipt check", () => {
    const e = expense({ receiptTotal: null });
    const r = run({ expenses: [e], lines: [line(e.id, { lineTotal: 1 })] });
    assert.equal(group(r, "receipt_gap").rows.length, 0);
  });

  test("a receipt total typed over the scan", () => {
    const e = expense({ receiptTotal: 110, receiptTotalScanned: 101, receiptTotalNote: "Scan misread the 1" });
    const r = run({ expenses: [e], lines: [line(e.id)] });
    const row = group(r, "total_changed").rows[0];
    assert.equal(row.amount, 9);
    assert.match(row.detail, /Scan misread the 1$/);
  });

  test("printed GST differing beyond rounding, but not within it", () => {
    const off = expense({ gst: 10, gstPrinted: 12 });
    const close = expense({ gst: 10, gstPrinted: 10.01 });
    const r = run({ expenses: [off, close], lines: [line(off.id), line(close.id)] });
    const rows = group(r, "gst_printed").rows;
    assert.deepEqual(rows.map((x) => [x.expenseId, x.amount]), [[off.id, 2]]);
  });

  test("unitemised, uncategorised and parent-category lines; a discount with no category is fine", () => {
    const e = expense({ total: 100 });
    const r = run({
      expenses: [e],
      lines: [
        line(e.id, { kind: "unallocated", lineTotal: 5, categoryId: null }),
        line(e.id, { kind: "goods", lineTotal: 20, categoryId: null }),
        line(e.id, { kind: "goods", lineTotal: 70, categoryId: "food", description: "Mixed groceries" }),
        line(e.id, { kind: "discount", lineTotal: -3, categoryId: null }),
      ],
    });
    assert.equal(group(r, "not_itemised").amount, 5);
    assert.equal(group(r, "uncategorised").amount, 20);
    const parent = group(r, "parent_category").rows[0];
    assert.equal(parent.amount, 70);
    assert.equal(parent.detail, "Mixed groceries — under Food");
    assert.equal(r.flaggedExpenses, 1);
  });

  test("disputed packs belong to the period's expenses only", () => {
    const e = expense();
    const r = run({
      expenses: [e],
      disputedPacks: [
        { expenseId: e.id, itemName: "Rice", lineTotal: 40, costPerBaseUnit: 0.004, baseUnit: "kg" },
        { expenseId: "elsewhere", itemName: "Flour", lineTotal: 9, costPerBaseUnit: 1, baseUnit: "kg" },
      ],
    });
    assert.deepEqual(group(r, "disputed_pack").rows.map((x) => x.amount), [40]);
  });

  test("a misdated expense submitted in the period is listed, but its money isn't the period's", () => {
    const inside = expense({ reportDate: "2026-08-01" });
    const r = run({
      expenses: [inside],
      dateConcerns: [
        { expenseId: inside.id, entry: inside.entry, vendor: "Harris Farm", status: "approved", total: 110, receiptDate: "2026-08-01", submittedOn: "2026-07-20", concern: "after_submission" },
        { expenseId: "old", entry: "E-0045", vendor: "Coles", status: "submitted", total: 55, receiptDate: "1994-09-11", submittedOn: "2026-09-02", concern: "year_before_submission" },
        { expenseId: "other", entry: "E-0001", vendor: "Coles", status: "submitted", total: 99, receiptDate: "1994-01-01", submittedOn: "2025-01-02", concern: "year_before_submission" },
      ],
    });
    const rows = group(r, "receipt_date").rows;
    assert.deepEqual(rows.map((x) => x.entry).sort(), [inside.entry, "E-0045"].sort());
    assert.equal(r.flaggedExpenses, 1);
    assert.equal(r.flaggedSpend, 110);
  });

  test("possible duplicates name what they look like", () => {
    const e = expense();
    const r = run({
      expenses: [e],
      duplicates: new Map([[e.id, [{ expenseId: "x", expenseNumber: "E-0099", status: "paid", reason: "same-invoice" as const }]]]),
    });
    assert.equal(group(r, "duplicate").rows[0].detail, "Looks like E-0099 (same invoice)");
  });

  test("a group's amount is the size of its differences, whichever way they go", () => {
    const over = expense({ receiptTotal: 100 });
    const under = expense({ receiptTotal: 120 });
    const r = run({ expenses: [over, under], lines: [line(over.id), line(under.id)] });
    assert.deepEqual(group(r, "receipt_gap").rows.map((x) => x.amount).sort(), [-10, 10]);
    assert.equal(group(r, "receipt_gap").amount, 20);
  });
});

describe("exceptionTables", () => {
  test("the CSV is every exception, not the summary", () => {
    const e = expense({ receiptTotal: 100 });
    const r = run({ expenses: [e], lines: [line(e.id), line(e.id, { kind: "goods", categoryId: null, lineTotal: 0 })] });
    const tables = exceptionTables(r);
    assert.equal(tables[0].title, "All exceptions");
    assert.equal(tables[0].rows.length, 2);
    assert.equal(tables[1].title, "Summary");
    assert.equal(tables[1].rows.length, EXCEPTION_CHECKS.length);
    // One sheet per check that found something.
    assert.equal(tables.length, 4);
    const csv = documentToCsv({ title: "Exceptions", subtitle: "Test", filenameBase: "x", tables });
    assert.match(csv, /Receipts that don't add up/);
  });
});

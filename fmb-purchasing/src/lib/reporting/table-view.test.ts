import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { ReportColumn } from "./tables.ts";
import { clampPage, formatCell, nextSort, pageCount, pageOfRows, pageOfTable, sortRows, tableStateFrom } from "./table-view.ts";

const columns: ReportColumn[] = [
  { key: "entry", label: "Entry", kind: "text" },
  { key: "date", label: "Date", kind: "date" },
  { key: "amount", label: "Amount", kind: "money" },
];
const rows = [
  { entry: "E-0010", date: "2026-07-03", amount: 50 },
  { entry: "E-0002", date: "2026-08-01", amount: null },
  { entry: "E-0100", date: "2026-07-03", amount: 200 },
  { entry: "E-0009", date: null, amount: 50 },
];
const entries = (rs: typeof rows) => rs.map((r) => r.entry);

describe("sortRows", () => {
  test("with no sort, the report's own order", () => {
    assert.deepEqual(entries(sortRows(rows, columns, null)), entries(rows));
    // A column the table doesn't have is no sort either.
    assert.deepEqual(entries(sortRows(rows, columns, { key: "nope", dir: "asc" })), entries(rows));
  });

  test("figures sort as figures, and ties keep the order they came in", () => {
    assert.deepEqual(entries(sortRows(rows, columns, { key: "amount", dir: "desc" })), ["E-0100", "E-0010", "E-0009", "E-0002"]);
    assert.deepEqual(entries(sortRows(rows, columns, { key: "amount", dir: "asc" })), ["E-0010", "E-0009", "E-0100", "E-0002"]);
  });

  test("blanks go last whichever way the column is sorted", () => {
    assert.equal(entries(sortRows(rows, columns, { key: "date", dir: "asc" })).at(-1), "E-0009");
    assert.equal(entries(sortRows(rows, columns, { key: "date", dir: "desc" })).at(-1), "E-0009");
  });

  test("entry numbers sort by their number, not letter by letter", () => {
    assert.deepEqual(entries(sortRows(rows, columns, { key: "entry", dir: "asc" })), ["E-0002", "E-0009", "E-0010", "E-0100"]);
  });

  test("it leaves the rows it was given as they were", () => {
    const before = entries(rows);
    sortRows(rows, columns, { key: "amount", dir: "desc" });
    assert.deepEqual(entries(rows), before);
  });
});

describe("nextSort", () => {
  test("a heading cycles: its natural order, the other way, then the report's own", () => {
    const amount = columns[2];
    const a = nextSort(null, amount);
    assert.deepEqual(a, { key: "amount", dir: "desc" });
    const b = nextSort(a, amount);
    assert.deepEqual(b, { key: "amount", dir: "asc" });
    assert.equal(nextSort(b, amount), null);
  });

  test("words start A to Z; another column starts afresh", () => {
    assert.deepEqual(nextSort({ key: "amount", dir: "asc" }, columns[0]), { key: "entry", dir: "asc" });
  });
});

describe("paging", () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ entry: `E-${i}`, date: "2026-07-01", amount: i }));

  test("fifty to a page, the last page short", () => {
    assert.equal(pageCount(120), 3);
    assert.equal(pageCount(0), 1);
    const p3 = pageOfRows(many, columns, { sort: null, page: 3 });
    assert.deepEqual([p3.rows.length, p3.from, p3.to, p3.total, p3.pages], [20, 101, 120, 120, 3]);
  });

  test("a page past the end is the last page, not an empty one", () => {
    assert.equal(clampPage(99, 120), 3);
    assert.equal(clampPage(0, 120), 1);
    assert.equal(pageOfRows(many, columns, { sort: null, page: 99 }).page, 3);
  });

  test("sorting happens before the cut, so page one of largest-first holds the largest", () => {
    const p1 = pageOfRows(many, columns, { sort: { key: "amount", dir: "desc" }, page: 1 });
    assert.equal(p1.rows[0].amount, 119);
    assert.equal(p1.rows.at(-1)!.amount, 70);
  });

  test("nothing to show is page one of one, rows 0 to 0", () => {
    const p = pageOfRows([], columns, { sort: null, page: 1 });
    assert.deepEqual([p.rows.length, p.from, p.to, p.pages], [0, 0, 0, 1]);
  });

  test("a table cut to a page keeps its totals, which are of every row", () => {
    const { table, view } = pageOfTable(
      { title: "T", columns, rows: many, totals: { entry: "Total", amount: 7140 } },
      { sort: null, page: 2 }
    );
    assert.equal(table.rows.length, 50);
    assert.equal(table.totals!.amount, 7140);
    assert.deepEqual([view.from, view.to, view.total], [51, 100, 120]);
  });
});

describe("tableStateFrom", () => {
  test("reads sort, dir and page; anything else is the table as it comes", () => {
    assert.deepEqual(tableStateFrom({ sort: "amount", dir: "asc", page: "3" }), { sort: { key: "amount", dir: "asc" }, page: 3 });
    assert.deepEqual(tableStateFrom({ sort: "amount" }), { sort: { key: "amount", dir: "desc" }, page: 1 });
    assert.deepEqual(tableStateFrom({ page: "-2", dir: "asc" }), { sort: null, page: 1 });
    assert.deepEqual(tableStateFrom({ page: "abc" }), { sort: null, page: 1 });
  });
});

describe("formatCell", () => {
  test("each kind reads as it should", () => {
    assert.equal(formatCell(1234.5, { kind: "money" }), "$1,234.50");
    assert.equal(formatCell(10, { kind: "money", signed: true }), "+$10.00");
    assert.equal(formatCell(-10, { kind: "money", signed: true }), "-$10.00");
    assert.equal(formatCell(0.615, { kind: "percent" }), "62%");
    assert.equal(formatCell(12000, { kind: "count" }), "12,000");
    assert.equal(formatCell("2026-07-05", { kind: "date" }), "05/07/2026");
    assert.equal(formatCell(null, { kind: "money" }), "—");
    assert.equal(formatCell(null, { kind: "text" }), "");
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { documentToCsv, safeFilename, type ReportDocument } from "./tables.ts";
import { documentToXlsx } from "./xlsx.ts";
import { spendReportTables } from "./spend-tables.ts";
import { budgetTables, type BudgetView } from "./budget-view.ts";
import { gstTables } from "./gst-tables.ts";
import { computeSpendReport } from "./spend-report.ts";
import { applyFilters, NO_FILTERS, type ExpenseRecord, type LineRecord } from "./aggregate.ts";
import { queryFromSearchParams } from "./query.ts";
import { summariseGst, type GstExpense } from "../gst-summary.ts";
import type { XeroBillLine } from "../xero-export.ts";

const doc: ReportDocument = {
  title: "Reports — Breakdown",
  subtitle: "FY 2026–27 · By receipt date · approved and paid",
  filenameBase: "reports-breakdown-au2026",
  tables: [
    {
      title: "Spend by vendor",
      columns: [
        { key: "label", label: "Vendor", kind: "text" },
        { key: "date", label: "First", kind: "date" },
        { key: "spend", label: "Total", kind: "money" },
        { key: "share", label: "Share", kind: "percent" },
      ],
      rows: [
        { label: 'Joe\'s "Best" Meats', date: "2026-07-03", spend: 300, share: 0.6 },
        { label: "مشک", date: null, spend: 200, share: 0.4 },
      ],
      totals: { label: "Total", spend: 500, share: 1 },
    },
    { title: "Headline", columns: [{ key: "a", label: "A", kind: "text" }], rows: [{ a: "x" }] },
  ],
};

describe("documentToCsv", () => {
  test("heading, then the first table with its totals — quoted properly and UTF-8 marked", () => {
    const csv = documentToCsv(doc);
    assert.ok(csv.startsWith("﻿"));
    const lines = csv.slice(1).split("\r\n");
    assert.equal(lines[0], "Reports — Breakdown");
    assert.equal(lines[1], "FY 2026–27 · By receipt date · approved and paid");
    assert.equal(lines[3], "Vendor,First,Total,Share");
    assert.equal(lines[4], '"Joe\'s ""Best"" Meats",2026-07-03,300,0.6');
    assert.equal(lines[5], "مشک,,200,0.4");
    assert.equal(lines[6], "Total,,500,1");
  });

  test("filenames keep to letters, numbers, dots and dashes", () => {
    assert.equal(safeFilename("reports-overview-r2026-07-01_2026-07-31"), "reports-overview-r2026-07-01_2026-07-31");
    assert.equal(safeFilename('gst "Q1"/2026'), "gst-Q1-2026");
  });
});

describe("documentToXlsx", () => {
  test("one sheet per table, with money as money and dates as dates", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await documentToXlsx(doc)) as unknown as ArrayBuffer);
    assert.deepEqual(
      workbook.worksheets.map((w) => w.name),
      ["Spend by vendor", "Headline"]
    );
    const sheet = workbook.getWorksheet("Spend by vendor")!;
    assert.equal(sheet.getCell("A1").value, "Reports — Breakdown");
    assert.equal(sheet.getCell("A4").value, "Vendor");
    assert.equal(sheet.getCell("C5").value, 300);
    assert.match(String(sheet.getColumn(3).numFmt), /\$/);
    assert.ok(sheet.getCell("B5").value instanceof Date, "a date cell, not text");
    assert.equal(sheet.getCell("A7").value, "Total");
  });

  test("sheet names Excel would refuse are made acceptable and kept unique", async () => {
    const workbook = new ExcelJS.Workbook();
    const clash: ReportDocument = {
      ...doc,
      tables: [
        { title: "Items: by month / vendor [all] and a name far too long", columns: [], rows: [] },
        { title: "Items: by month / vendor [all] and a name far too long", columns: [], rows: [] },
      ],
    };
    await workbook.xlsx.load(Buffer.from(await documentToXlsx(clash)) as unknown as ArrayBuffer);
    const names = workbook.worksheets.map((w) => w.name);
    assert.equal(new Set(names).size, 2);
    for (const name of names) assert.ok(name.length <= 31 && !/[:\\/?*[\]]/.test(name), name);
  });
});

/* ------------------------------------------------------------------ */
/* A download's totals are the page's figures                          */
/* ------------------------------------------------------------------ */

const e = (id: string, vendor: string, reportDate: string, total: number) =>
  ({
    id,
    expenseNumber: id,
    vendorId: vendor,
    vendorName: vendor,
    status: "approved",
    receiptDate: reportDate,
    createdAt: `${reportDate}T01:00:00Z`,
    reportDate,
    total,
    gst: 0,
  }) as ExpenseRecord;
const l = (expenseId: string, categoryId: string, lineTotal: number, gst = 0): LineRecord => ({
  expenseId,
  categoryId,
  categoryName: categoryId,
  itemId: null,
  itemName: "x",
  lineTotal,
  gst,
  gstApportioned: false,
  quantity: 1,
});
const slice = applyFilters(
  [e("e1", "Madani", "2026-07-03", 330), e("e2", "Costco", "2026-08-10", 200)],
  [l("e1", "meat", 300), l("e1", "dry", 30, 2.73), l("e2", "dry", 200)],
  NO_FILTERS
);

describe("Reports download", () => {
  for (const section of ["overview", "breakdown", "compare", "transactions"]) {
    test(`${section}: the main table's total is the page's total spend`, () => {
      const report = computeSpendReport({
        current: slice,
        previous: null,
        unitCosts: [],
        query: queryFromSearchParams({ section }, "au2026"),
        periodLabel: "FY",
        previousLabel: "FY-1",
      });
      const [main] = spendReportTables(report, "FY", "FY-1");
      const total = main.totals!;
      const sum = Object.entries(total)
        .filter(([k, v]) => typeof v === "number" && k !== "count" && k !== "gst" && k !== "share")
        .reduce((s, [, v]) => s + (v as number), 0);
      assert.equal(Math.round(sum * 100) / 100, report.now.spend);
    });
  }
});

describe("Budgets download", () => {
  test("Spent adds up to total spend, parent-category and uncategorised spend included", () => {
    const view: BudgetView = {
      rows: [
        { id: "a", label: "Meat › Mutton", budget: 1000, share: undefined, spent: 600, paid: 400, committed: 200, usedPct: 0.6 },
        { id: "b", label: "Dry goods", budget: null, share: undefined, spent: 100, paid: 0, committed: 100, usedPct: null },
      ],
      totals: { budgeted: 1000, spentAgainstBudgets: 600, remaining: 400, paid: 400, committed: 300 },
      budgets: [],
      onParentCategories: [{ categoryId: "m", label: "Meat", amount: 5760 }],
      uncategorised: 20,
      months: [],
    };
    const [table] = budgetTables(view);
    assert.equal(table.totals!.spent, 6480);
    assert.equal(table.totals!.remaining, 400);
    assert.equal(table.rows.length, 4);
  });
});

describe("GST download", () => {
  test("the detail's amounts are G10 + G11, and its GST is 1B", () => {
    const expenses: GstExpense[] = [
      { id: "e1", expenseNumber: "E-1", vendorName: "Equipment Co", total: 8816.5, gst: 798.5, hasAttachment: true, vendorAbn: "1", vendorGstRegistered: true, lateForLockedPeriod: false },
    ];
    const lines: XeroBillLine[] = [
      { expenseId: "e1", expenseNumber: "E-1", invoiceNumber: null, contactName: "Equipment Co", invoiceDate: "2026-07-20", dueDate: "2026-07-20", description: "Oven", lineTotal: 8800, gst: 800, isCapital: true, accountCode: "700" },
      { expenseId: "e1", expenseNumber: "E-1", invoiceNumber: null, contactName: "Equipment Co", invoiceDate: "2026-07-20", dueDate: "2026-07-20", description: "Discount", lineTotal: -16.5, gst: -1.5, isCapital: false, accountCode: null },
      { expenseId: "e1", expenseNumber: "E-1", invoiceNumber: null, contactName: "Equipment Co", invoiceDate: "2026-07-20", dueDate: "2026-07-20", description: "Milk", lineTotal: 33, gst: 0, isCapital: false, accountCode: "400" },
    ];
    const summary = summariseGst(expenses, lines.map((x) => ({ expenseId: "e1", lineTotal: x.lineTotal, gst: x.gst, isCapital: x.isCapital, gstApportioned: false })));
    const [detail] = gstTables(summary, expenses, lines);
    assert.equal(detail.totals!.amount, summary.g10 + summary.g11);
    assert.equal(detail.totals!.gst, summary.oneB);
    assert.deepEqual(detail.rows.map((r) => r.taxType), ["CAPEXINPUT", "INPUT", "EXEMPTEXPENSES"]);
  });
});

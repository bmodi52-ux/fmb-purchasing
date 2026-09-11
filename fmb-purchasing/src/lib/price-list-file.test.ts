import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isPriceListFile, parseCsv, priceListChunks, readPriceListRows, tidyRows } from "./price-list-file.ts";

describe("parseCsv", () => {
  test("quoted cells keep their commas, quotes and line breaks", () => {
    const rows = parseCsv('﻿Product,Size,Price\r\n"Rice, Basmati",10kg,$32.50\n"Oil ""Extra""","5\nL",21\n');
    assert.deepEqual(rows, [
      ["Product", "Size", "Price"],
      ["Rice, Basmati", "10kg", "$32.50"],
      ['Oil "Extra"', "5\nL", "21"],
    ]);
  });

  test("a last line without a line break is kept", () => {
    assert.deepEqual(parseCsv("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
  });
});

describe("priceListChunks", () => {
  test("empty rows go, and each piece starts with the headings", () => {
    const rows = tidyRows([["Product", "Price", ""], ["", ""], ["Rice", "32"], ["Oil", "21"], ["Salt", "2"]]);
    const chunks = priceListChunks(rows, 2);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].text, "Product,Price\nRice,32\nOil,21");
    assert.equal(chunks[1].text, "Product,Price\nSalt,2");
    assert.deepEqual([chunks[1].from, chunks[1].to], [4, 4]);
  });
});

describe("files", () => {
  test("recognised by extension, since Windows often sends a CSV with no useful type", () => {
    assert.equal(isPriceListFile({ name: "PRICES.CSV", type: "application/vnd.ms-excel" }), true);
    assert.equal(isPriceListFile({ name: "list.xlsx", type: "" }), true);
    assert.equal(isPriceListFile({ name: "tag.jpg", type: "image/jpeg" }), false);
  });

  test("an Excel file's sheets are read row by row, formulas by their result", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Dry goods");
    sheet.addRow(["Product", "Pack", "Price"]);
    sheet.addRow(["Basmati Rice", "10kg bag", 32.5]);
    sheet.addRow([]);
    sheet.addRow(["Chickpeas", "25kg", { formula: "20+5", result: 25 }]);
    const bytes = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;

    const rows = await readPriceListRows({ name: "supplier.xlsx", bytes });
    assert.deepEqual(rows, [
      ["Product", "Pack", "Price"],
      ["Basmati Rice", "10kg bag", "32.5"],
      ["Chickpeas", "25kg", "25"],
    ]);
  });
});

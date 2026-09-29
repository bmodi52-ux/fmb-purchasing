import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv } from "./csv.ts";

describe("csvCell", () => {
  test("plain text and numbers go as they are", () => {
    assert.equal(csvCell("Costco"), "Costco");
    assert.equal(csvCell(1320.5), "1320.5");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
  });

  test("a quote inside is doubled, not backslashed", () => {
    // JSON.stringify gave "Joe's \"Best\" Meats", which Excel splits in two.
    assert.equal(csvCell('Joe\'s "Best" Meats'), '"Joe\'s ""Best"" Meats"');
  });

  test("commas and line breaks are quoted", () => {
    assert.equal(csvCell("Rice, 25kg"), '"Rice, 25kg"');
    assert.equal(csvCell("line one\nline two"), '"line one\nline two"');
  });

  test("text Excel would run as a formula is defused", () => {
    assert.equal(csvCell('=HYPERLINK("http://x","click")'), `"'=HYPERLINK(""http://x"",""click"")"`);
    assert.equal(csvCell("+61 400 000 000"), "'+61 400 000 000");
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvCell("-10% off"), "'-10% off");
  });

  test("numbers are never touched, negative ones included", () => {
    assert.equal(csvCell(-16.5), "-16.5");
    assert.equal(csvCell("-16.50"), "-16.50");
    assert.equal(csvCell("+3"), "+3");
  });

  test("the guard can be turned off, for files no spreadsheet opens", () => {
    assert.equal(csvCell("-10% off", { guardFormulas: false }), "-10% off");
  });
});

describe("toCsv", () => {
  test("starts with a byte-order mark so Excel reads UTF-8, and keeps Arabic intact", () => {
    const csv = toCsv([["vendor"], ["مشک"]]);
    assert.ok(csv.startsWith("﻿"));
    assert.equal(csv, "﻿vendor\r\nمشک\r\n");
  });

  test("without a BOM when asked", () => {
    assert.equal(toCsv([["a", "b"], [1, 2]], { bom: false }), "a,b\r\n1,2\r\n");
  });
});

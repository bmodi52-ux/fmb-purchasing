import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeReceiptDate, formatPlainDate } from "./format.ts";

/**
 * The two cases at the top were found by running real receipts through
 * scripts/compare-extraction.mjs. Both models returned the date exactly as the
 * receipt printed it, which the previous `new Date(raw)` implementation either
 * discarded or misread as an American date.
 */
describe("normalizeReceiptDate", () => {
  test("a day-first date is read day-first, not month-first", () => {
    // Foodworks Guildford, 02/07/2026 — 2 July. new Date() made this 7 February,
    // which is a valid, plausible, wrong date in a different fiscal month.
    assert.equal(normalizeReceiptDate("02/07/2026"), "2026-07-02");
  });

  test("a day past 12 is kept rather than dropped", () => {
    // Bankstown Lebanese Fruit, 27/06/2026. new Date() returned Invalid Date,
    // so the field silently came back empty and had to be retyped.
    assert.equal(normalizeReceiptDate("27/06/2026"), "2026-06-27");
  });

  test("ISO passes through unchanged", () => {
    assert.equal(normalizeReceiptDate("2026-07-16"), "2026-07-16");
  });

  test("single-digit day and month are padded", () => {
    assert.equal(normalizeReceiptDate("2/7/2026"), "2026-07-02");
  });

  test("hyphen and dot separators are accepted", () => {
    assert.equal(normalizeReceiptDate("30-08-2026"), "2026-08-30");
    assert.equal(normalizeReceiptDate("05.09.2026"), "2026-09-05");
  });

  test("surrounding whitespace is tolerated", () => {
    assert.equal(normalizeReceiptDate("  16/07/2026 "), "2026-07-16");
  });

  test("an impossible date is refused, not rolled over", () => {
    // new Date(2026, 1, 31) silently becomes 3 March.
    assert.equal(normalizeReceiptDate("31/02/2026"), "");
    assert.equal(normalizeReceiptDate("2026-02-31"), "");
    assert.equal(normalizeReceiptDate("00/07/2026"), "");
    assert.equal(normalizeReceiptDate("13/13/2026"), "");
  });

  test("a leap day is real in a leap year and not otherwise", () => {
    assert.equal(normalizeReceiptDate("29/02/2028"), "2028-02-29");
    assert.equal(normalizeReceiptDate("29/02/2026"), "");
  });

  test("two dates in one string are left for a person", () => {
    // A real answer from a PDF holding two invoices.
    assert.equal(normalizeReceiptDate("11/07/2026 and 16/07/2026"), "");
  });

  test("anything unparseable yields empty rather than a guess", () => {
    assert.equal(normalizeReceiptDate("16 July 2026"), "");
    assert.equal(normalizeReceiptDate("last Tuesday"), "");
    assert.equal(normalizeReceiptDate("16/07/26"), "");
    assert.equal(normalizeReceiptDate(""), "");
    assert.equal(normalizeReceiptDate(null), "");
    assert.equal(normalizeReceiptDate(undefined), "");
  });
});

describe("formatPlainDate", () => {
  test("renders a database date as the same calendar day", () => {
    // Never shifted by a timezone: `date` columns carry no time.
    assert.equal(formatPlainDate("2026-07-02"), "02/07/2026");
    assert.equal(formatPlainDate("2026-01-01"), "01/01/2026");
  });

  test("tolerates a full timestamp", () => {
    assert.equal(formatPlainDate("2026-07-02T00:00:00Z"), "02/07/2026");
  });
});

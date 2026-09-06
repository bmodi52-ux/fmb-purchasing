import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  activeCount,
  inferFilterKind,
  isActive,
  matchesFilter,
  parseDateKey,
  parseNumeric,
  VALUE_LIST_LIMIT,
} from "./column-filter";

/**
 * Column filtering, which replaced one substring box per column.
 *
 * Tested away from the table because the parts that can be quietly wrong are
 * arithmetic: money rendered as "$5,760.00", and Australian dates that print
 * day first. A filter that reads 02/07/2026 as February would put the wrong
 * months in front of somebody reconciling a quarter, and say nothing.
 */

describe("parseNumeric", () => {
  test("reads money as these tables print it", () => {
    assert.equal(parseNumeric("$5,760.00"), 5760);
    assert.equal(parseNumeric("1,944"), 1944);
    assert.equal(parseNumeric("-$9.20"), -9.2);
  });

  test("distinguishes blank from zero", () => {
    assert.equal(parseNumeric(""), null, "Number('') is 0, which would filter blanks as zeroes");
    assert.equal(parseNumeric("   "), null);
    assert.equal(parseNumeric("0"), 0);
  });

  test("refuses text that merely contains digits", () => {
    assert.equal(parseNumeric("E-0003"), null);
    assert.equal(parseNumeric("INV1802"), null);
    assert.equal(parseNumeric("-"), null);
  });
});

describe("parseDateKey", () => {
  test("reads an Australian date day-first", () => {
    assert.equal(
      parseDateKey("02/07/2026"),
      "2026-07-02",
      "receipts here print day first; February would be a silent, wrong answer"
    );
    assert.equal(parseDateKey("29/08/2026"), "2026-08-29");
  });

  test("passes an ISO date through", () => {
    assert.equal(parseDateKey("2026-09-01"), "2026-09-01");
    assert.equal(parseDateKey("2026-09-01T04:10:00Z"), "2026-09-01");
  });

  test("pads a single-digit day and month so keys compare as strings", () => {
    assert.equal(parseDateKey("2/7/2026"), "2026-07-02");
  });

  test("returns null for anything that is not a date", () => {
    assert.equal(parseDateKey("Foodworks Guildford"), null);
    assert.equal(parseDateKey(""), null);
    assert.equal(parseDateKey("1944"), null);
  });
});

describe("inferFilterKind", () => {
  test("a handful of repeated words is a tick list", () => {
    assert.equal(inferFilterKind(["submitted", "approved", "submitted", "paid"]), "values");
  });

  test("dates get a range", () => {
    assert.equal(inferFilterKind(["02/07/2026", "29/08/2026", "01/09/2026"]), "dates");
  });

  test("many distinct amounts get a range", () => {
    const amounts = Array.from({ length: VALUE_LIST_LIMIT + 5 }, (_, i) => `$${i * 10}.00`);
    assert.equal(inferFilterKind(amounts), "range");
  });

  test("few distinct numbers stay a tick list", () => {
    // A year column is numeric, but picking 1448 from three options beats
    // bracketing it.
    assert.equal(inferFilterKind(["1448", "1449", "1448", "1447"]), "values");
  });

  test("blanks do not stop a column being read as dates", () => {
    assert.equal(inferFilterKind(["02/07/2026", "", "  ", "29/08/2026"]), "dates");
  });

  test("an empty column offers a tick list rather than throwing", () => {
    assert.equal(inferFilterKind([]), "values");
    assert.equal(inferFilterKind(["", ""]), "values");
  });

  test("a mixed column is never treated as numeric", () => {
    assert.equal(inferFilterKind(["100", "Chicken", "250"]), "values");
  });
});

describe("matchesFilter", () => {
  test("an empty selection is the absence of a filter, not a rejection of everything", () => {
    assert.equal(
      matchesFilter("anything", { type: "values", values: [] }),
      true,
      "otherwise the table blanks the moment the last box is unticked"
    );
  });

  test("value filters match exactly, not by substring", () => {
    const filter = { type: "values" as const, values: ["approved"] };
    assert.equal(matchesFilter("approved", filter), true);
    assert.equal(matchesFilter("not approved", filter), false);
  });

  test("a range is inclusive at both ends", () => {
    const filter = { type: "range" as const, min: 100, max: 200 };
    assert.equal(matchesFilter("$100.00", filter), true);
    assert.equal(matchesFilter("$200.00", filter), true);
    assert.equal(matchesFilter("$99.99", filter), false);
    assert.equal(matchesFilter("$200.01", filter), false);
  });

  test("an open-ended range only constrains the end that was given", () => {
    assert.equal(matchesFilter("$5,760.00", { type: "range", min: 500, max: null }), true);
    assert.equal(matchesFilter("$12.00", { type: "range", min: 500, max: null }), false);
    assert.equal(matchesFilter("$12.00", { type: "range", min: null, max: 500 }), true);
  });

  test("a blank cell fails a range rather than counting as zero", () => {
    assert.equal(matchesFilter("", { type: "range", min: null, max: 10 }), false);
  });

  test("date ranges compare day-first dates correctly", () => {
    const august = { type: "dates" as const, from: "2026-08-01", to: "2026-08-31" };
    assert.equal(matchesFilter("29/08/2026", august), true);
    assert.equal(matchesFilter("01/09/2026", august), false);
    assert.equal(
      matchesFilter("02/07/2026", august),
      false,
      "read month-first this would be 7 February and still excluded — so check one that would flip"
    );
    assert.equal(
      matchesFilter("08/02/2026", august),
      false,
      "8 February, which a month-first reading would wrongly place in August"
    );
  });
});

describe("isActive and activeCount", () => {
  test("an empty filter of any kind counts for nothing", () => {
    assert.equal(isActive(undefined), false);
    assert.equal(isActive({ type: "values", values: [] }), false);
    assert.equal(isActive({ type: "range", min: null, max: null }), false);
    assert.equal(isActive({ type: "dates", from: null, to: null }), false);
  });

  test("counts only the columns actually narrowing the table", () => {
    assert.equal(
      activeCount({
        status: { type: "values", values: ["approved"] },
        vendor: { type: "values", values: [] },
        total: { type: "range", min: 100, max: null },
      }),
      2
    );
  });
});

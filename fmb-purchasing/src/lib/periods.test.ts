import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gregorianToHijri, hijriToGregorian } from "./hijri/hijri.ts";
import {
  addDays,
  dayCount,
  inPeriod,
  isoFromLocal,
  monthOf,
  parsePeriod,
  partsOfYear,
  previousPeriod,
  yearContaining,
  yearsToOffer,
} from "./periods.ts";

/**
 * Periods — scratchpad #22. The reference dates come from hijri.ts's own
 * calibration: 15 Jun 2026 is 1 Muharram 1448H.
 */

const TODAY = "2026-09-11";

describe("hijriToGregorian", () => {
  test("inverts gregorianToHijri across a full 30-year cycle", () => {
    let date = new Date(2010, 0, 1);
    for (let i = 0; i < 11_000; i += 7) {
      const hijri = gregorianToHijri(date);
      assert.equal(isoFromLocal(hijriToGregorian(hijri)), isoFromLocal(date));
      date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
    }
  });

  test("matches the calibration point", () => {
    assert.equal(isoFromLocal(hijriToGregorian({ year: 1448, month: 1, day: 1 })), "2026-06-15");
  });
});

describe("parsePeriod", () => {
  test("a Hijri fiscal year runs 1 Shawwal to the end of Ramadan, 354 or 355 days", () => {
    const p = parsePeriod("h1447", TODAY);
    assert.equal(gregorianToHijri(new Date(p.start + "T00:00:00")).month, 10);
    assert.equal(gregorianToHijri(new Date(p.end + "T00:00:00")).month, 9);
    assert.ok([354, 355].includes(dayCount(p.start, p.end)));
    assert.equal(p.label, "1447-48 H");
  });

  test("the Australian financial year is 1 July to 30 June", () => {
    const p = parsePeriod("au2026", TODAY);
    assert.deepEqual([p.start, p.end, p.label], ["2026-07-01", "2027-06-30", "FY 2026–27"]);
  });

  test("quarters and months follow the chosen year", () => {
    assert.deepEqual(
      [parsePeriod("au2026-q1", TODAY).start, parsePeriod("au2026-q1", TODAY).end],
      ["2026-07-01", "2026-09-30"]
    );
    assert.deepEqual([parsePeriod("cy2026-m2", TODAY).start, parsePeriod("cy2026-m2", TODAY).end], ["2026-02-01", "2026-02-28"]);
    assert.equal(parsePeriod("h1447-m1", TODAY).label, "Shawwal 1447");
    assert.equal(parsePeriod("h1447-m4", TODAY).label, "Muharram 1448");
  });

  test("the twelve months of a Hijri year join up with no gaps", () => {
    for (let m = 1; m < 12; m++) {
      assert.equal(addDays(monthOf("hijri", 1447, m).end, 1), monthOf("hijri", 1447, m + 1).start);
    }
  });

  test("a custom range, so far this year, and the last twelve months", () => {
    assert.deepEqual(
      [parsePeriod("r2026-01-15_2026-02-14", TODAY).start, parsePeriod("r2026-01-15_2026-02-14", TODAY).end],
      ["2026-01-15", "2026-02-14"]
    );
    assert.deepEqual([parsePeriod("au-ytd", TODAY).start, parsePeriod("au-ytd", TODAY).end], ["2026-07-01", TODAY]);
    assert.equal(dayCount(parsePeriod("last12", TODAY).start, TODAY), 365);
  });

  test("the current year of a kind is resolved when read", () => {
    assert.equal(parsePeriod("au-current", TODAY).start, "2026-07-01");
    assert.equal(parsePeriod("au-current", "2027-07-02").start, "2027-07-01");
  });

  test("an old fiscal-year number, and anything unreadable, still land somewhere sensible", () => {
    assert.equal(parsePeriod("1447", TODAY).code, "h1447");
    assert.equal(parsePeriod("nonsense", TODAY).code, `h${yearContaining("hijri", TODAY)}`);
    assert.equal(parsePeriod("r2026-02-30_2026-03-01", TODAY).calendar, "hijri");
  });
});

describe("previousPeriod", () => {
  test("steps back within the same calendar", () => {
    assert.equal(previousPeriod(parsePeriod("au2026", TODAY), TODAY).code, "au2025");
    assert.equal(previousPeriod(parsePeriod("au2026-q1", TODAY), TODAY).code, "au2025-q4");
    assert.equal(previousPeriod(parsePeriod("h1447-m1", TODAY), TODAY).code, "h1446-m12");
  });

  test("a range compares with the equally long range before it", () => {
    const prev = previousPeriod(parsePeriod("r2026-03-01_2026-03-10", TODAY), TODAY);
    assert.deepEqual([prev.start, prev.end], ["2026-02-19", "2026-02-28"]);
  });

  test("so far this year compares with the same stretch of last year", () => {
    const prev = previousPeriod(parsePeriod("au-ytd", TODAY), TODAY);
    assert.deepEqual([prev.start, prev.end], ["2025-07-01", "2025-09-11"]);
  });
});

describe("offering choices", () => {
  test("years from the earliest record to now, newest first", () => {
    assert.deepEqual(yearsToOffer("au", "2025-03-01", TODAY), [2026, 2025, 2024]);
    assert.deepEqual(yearsToOffer("cy", null, TODAY), [2026]);
  });

  test("a year offers itself, four quarters and twelve months", () => {
    assert.equal(partsOfYear("au", 2026).length, 17);
    assert.equal(partsOfYear("au", 2026)[1].label, "Q1 (Jul–Sep)");
  });

  test("inPeriod is inclusive at both ends", () => {
    const p = parsePeriod("au2026", TODAY);
    assert.equal(inPeriod(p, "2026-07-01"), true);
    assert.equal(inPeriod(p, "2027-06-30"), true);
    assert.equal(inPeriod(p, "2027-07-01"), false);
  });
});

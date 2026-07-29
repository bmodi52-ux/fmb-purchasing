/**
 * Verification suite for hijri.js — the Misri (Dawoodi Bohra) Hijri calendar.
 *
 * Every check here reflects a real verification step performed during
 * development, against independent sources:
 *   1. Rule logic cross-checked against thedawoodibohras.com's own
 *      published explanation of the calendar (month pattern, leap rule,
 *      worked example).
 *   2. Epoch/day-alignment cross-checked against the original
 *      mumineencalendar.com calendar grid (Nov 2013).
 *   3. Epoch re-confirmed against a user-supplied correction
 *      (15 Jun 2026 = 1 Muharram 1448H).
 *   4. 1 Muharram / 1 Ramadan dates for 1448H-1455H confirmed correct
 *      by the user against their own reference.
 *   5. Internal calendar-pattern identities (Rajab/Ramadan/Zilhijja day
 *      coincidences) checked for logical consistency.
 *
 * The whole fiscal year depends on this conversion, so these are the
 * assertions that stop a "harmless tidy-up" of hijri.js quietly refiling
 * every expense in the system.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gregorianToHijri, formatHijri } from "./hijri.js";

/**
 * hijri.js only exposes forward conversion, so finding the Gregorian date of
 * a given Hijri date means scanning. Fine for a test utility.
 */
function hijriDateToGregorian(y, m, day) {
  let d = new Date(2000, 0, 1);
  for (let i = 0; i < 366 * 40; i++) {
    const h = gregorianToHijri(d);
    if (h.year === y && h.month === m && h.day === day) return d;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return null;
}

function daysInHijriYear(year) {
  const start = hijriDateToGregorian(year, 1, 1);
  const next = hijriDateToGregorian(year + 1, 1, 1);
  return Math.round((next - start) / 86400000);
}

describe("gregorianToHijri", () => {
  test("matches the mumineencalendar.com grid day-by-day, Nov 2013", () => {
    const expected = {
      4: "1 Muharram al-Haraam 1435H",
      5: "2 Muharram al-Haraam 1435H",
      6: "3 Muharram al-Haraam 1435H",
      9: "6 Muharram al-Haraam 1435H",
    };
    for (const [day, want] of Object.entries(expected)) {
      assert.equal(formatHijri(gregorianToHijri(new Date(2013, 10, +day))), want);
    }
  });

  test("matches the user-confirmed epoch correction", () => {
    assert.equal(
      formatHijri(gregorianToHijri(new Date(2026, 5, 15))),
      "1 Muharram al-Haraam 1448H"
    );
  });
});

describe("year lengths follow the 30-year leap cycle", () => {
  // The site's own worked example: 1431H is kabisa, 1432H is not.
  test("1431H is a leap (kabisa) year of 355 days", () => {
    assert.equal(daysInHijriYear(1431), 355);
  });

  test("1432H is an ordinary year of 354 days", () => {
    assert.equal(daysInHijriYear(1432), 354);
  });
});

describe("1 Muharram falls on the dates the user confirmed, 1448H-1455H", () => {
  const confirmed = {
    1448: "Mon Jun 15 2026",
    1449: "Sat Jun 05 2027",
    1450: "Wed May 24 2028",
    1451: "Mon May 14 2029",
    1452: "Fri May 03 2030",
    1453: "Tue Apr 22 2031",
    1454: "Sun Apr 11 2032",
    1455: "Thu Mar 31 2033",
  };

  for (const [year, want] of Object.entries(confirmed)) {
    test(`${year}H`, () => {
      const d = hijriDateToGregorian(+year, 1, 1);
      assert.ok(d, `could not locate 1 Muharram ${year}H`);
      assert.equal(d.toDateString(), want);
    });
  }
});

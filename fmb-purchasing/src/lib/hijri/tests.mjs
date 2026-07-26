/**
 * tests.mjs
 * Verification suite for hijri.js — the Misri (Dawoodi Bohra) Hijri calendar.
 *
 * Run with: node tests.mjs
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
 */

import { gregorianToHijri, formatHijri } from "./hijri.js";

let pass = 0, fail = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"} — ${label}: got "${actual}", expected "${expected}"`);
  ok ? pass++ : fail++;
}

// 1. Original mumineencalendar.com scraped grid, Nov 2013 (day-by-day)
check("4 Nov 2013", formatHijri(gregorianToHijri(new Date(2013, 10, 4))), "1 Muharram al-Haraam 1435H");
check("5 Nov 2013", formatHijri(gregorianToHijri(new Date(2013, 10, 5))), "2 Muharram al-Haraam 1435H");
check("6 Nov 2013", formatHijri(gregorianToHijri(new Date(2013, 10, 6))), "3 Muharram al-Haraam 1435H");
check("9 Nov 2013", formatHijri(gregorianToHijri(new Date(2013, 10, 9))), "6 Muharram al-Haraam 1435H");

// 2. User-confirmed correction
check("15 Jun 2026", formatHijri(gregorianToHijri(new Date(2026, 5, 15))), "1 Muharram al-Haraam 1448H");

// 3. Site's own worked example: 1431H is kabisa, 1432H is not.
//    (Indirect check: confirm month 12 length behaves accordingly by checking
//    that 30 Zilhijja 1431H exists as a valid date, i.e. resolves to 1 Muharram 1432H
//    only on day 355, not day 354.)
function daysInHijriYear(year) {
  const start = new Date(2000, 0, 1); // arbitrary anchor unused; recompute via search
  // Instead, count by scanning forward from 1 Muharram to next 1 Muharram.
  let d = hijriDateToGregorian(year, 1, 1);
  let next = hijriDateToGregorian(year + 1, 1, 1);
  return Math.round((next - d) / 86400000);
}
function hijriDateToGregorian(y, m, day) {
  // brute-force search since hijri.js only exposes forward conversion;
  // fine for a one-off test utility.
  let d = new Date(2000, 0, 1);
  for (let i = 0; i < 366 * 40; i++) {
    const h = gregorianToHijri(d);
    if (h.year === y && h.month === m && h.day === day) return d;
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  }
  return null;
}
check("1431H year length (kabisa -> 355 days)", daysInHijriYear(1431), 355);
check("1432H year length (normal -> 354 days)", daysInHijriYear(1432), 354);

// 4. User-confirmed 1 Muharram dates, 1448H-1455H
const confirmedNewYears = {
  1448: "Mon Jun 15 2026",
  1449: "Sat Jun 05 2027",
  1450: "Wed May 24 2028",
  1451: "Mon May 14 2029",
  1452: "Fri May 03 2030",
  1453: "Tue Apr 22 2031",
  1454: "Sun Apr 11 2032",
  1455: "Thu Mar 31 2033",
};
for (const [year, expectedStr] of Object.entries(confirmedNewYears)) {
  const d = hijriDateToGregorian(+year, 1, 1);
  check(`${year}H 1 Muharram`, d.toDateString(), expectedStr);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);

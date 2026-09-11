/**
 * hijri.ts
 * Dawoodi Bohra (Misri) tabular Hijri calendar utilities.
 *
 * Implements the Fatimid/Misri discrete tabular calendar: fixed 30-year
 * cycles of 354-day years, with an 11-year leap pattern that adds a 355th
 * day (to the last month, Zilhijja) in years whose position in the cycle
 * is 2, 5, 8, 10, 13, 16, 19, 21, 24, 27, or 29. This is a deterministic
 * calculation (not moon-sighting based), matching the method described in
 * the Dawoodi Bohra dawat's "Bu Saheba Sahifa".
 *
 * Epoch calibrated and verified against two independent reference points:
 *  - 4 Nov 2013  -> 1 Muharram 1435H
 *  - 15 Jun 2026 -> 1 Muharram 1448H
 * Every day in the Nov 2013 range was also checked against the original
 * community calendar grid and matched exactly.
 *
 * Usage:
 *   import { gregorianToHijri, formatHijri, buildMonthGrid } from './hijri.ts';
 */

/** A date on the Misri calendar. `month` is 1-12, 1 = Muharram. */
export type HijriDate = { year: number; month: number; day: number };

/** One day cell of a dual Gregorian/Hijri calendar grid. */
export type MonthCell = { gregorian: Date; hijri: HijriDate; inCurrentMonth: boolean };

export const HIJRI_MONTHS_EN = [
  "Muharram al-Haraam", "Safar al-Muzaffar", "Rabi al-Awwal", "Rabi al-Aakhar",
  "Jumada al-Ula", "Jumada al-Ukhra", "Rajab al-Asab", "Shabaan al-Karim",
  "Ramadan al-Moazzam", "Shawwal al-Mukarram", "Zilqadatil Haraam", "Zilhajjatil Haraam"
];

export const HIJRI_MONTHS_AR = [
  "محرم الحرام", "صفر المظفر", "ربيع الاول", "ربيع الآخر",
  "جمادى الاولى", "جمادى الأخرى", "رجب الاصب", "شعبان الكريم",
  "رمضان المعظم", "شوال المكرم", "ذوالقعدة الحرام", "ذوالحجة الحرام"
];

const ARABIC_INDIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

/** Convert an integer to Arabic-Indic numeral string (e.g. 12 -> "١٢"). */
export function toArabicNumeral(n: number | string): string {
  return String(n).split("").map(d => (/\d/.test(d) ? ARABIC_INDIC_DIGITS[+d] : d)).join("");
}

// --- Fatimid/Misri tabular calendar core -----------------------------

const LEAP_POSITIONS = new Set([2, 5, 8, 10, 13, 16, 19, 21, 24, 27, 29]);
const CIVIL_EPOCH_JD = 1948439; // JD immediately before 1 Muharram 1 AH, calibrated per header note

function isLeapYear(hijriYear: number): boolean {
  let k = hijriYear % 30;
  if (k === 0) k = 30;
  return LEAP_POSITIONS.has(k);
}

function monthLengthsForYear(hijriYear: number): number[] {
  const lengths = [30, 29, 30, 29, 30, 29, 30, 29, 30, 29, 30, 29];
  if (isLeapYear(hijriYear)) lengths[11] = 30;
  return lengths;
}

function gregorianToJD(date: Date): number {
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  let m = month, y = year;
  if (m < 3) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524;
}

function jdToHijri(jd: number): HijriDate {
  const n = jd - CIVIL_EPOCH_JD; // days elapsed since 1 Muharram 1 AH (0-indexed)
  const cycles = Math.floor(n / 10631);
  const remDays = n - cycles * 10631;

  let k = 1, cum = 0;
  while (true) {
    const len = 354 + (LEAP_POSITIONS.has(k) ? 1 : 0);
    if (remDays < cum + len) break;
    cum += len;
    k++;
  }
  const daysIntoYear = remDays - cum;
  const hijriYear = cycles * 30 + k;

  const lengths = monthLengthsForYear(hijriYear);
  let m = 0, cum2 = 0;
  while (cum2 + lengths[m] <= daysIntoYear) { cum2 += lengths[m]; m++; }

  return { year: hijriYear, month: m + 1, day: daysIntoYear - cum2 + 1 };
}

/**
 * Convert a Gregorian JS Date to a Misri/Hijri {day, month, year}.
 * month is 1-12 (1 = Muharram).
 */
export function gregorianToHijri(date: Date): HijriDate {
  return jdToHijri(gregorianToJD(date));
}

/** Days in a Hijri month on this calendar: 30 or 29, and 30 for a leap Zilhijja. */
export function hijriMonthLength(year: number, month: number): number {
  return monthLengthsForYear(year)[month - 1];
}

function hijriToJD({ year, month, day }: HijriDate): number {
  const cycles = Math.floor((year - 1) / 30);
  const position = year - cycles * 30; // 1..30 within its cycle
  let n = cycles * 10631;
  for (let k = 1; k < position; k++) n += 354 + (LEAP_POSITIONS.has(k) ? 1 : 0);
  const lengths = monthLengthsForYear(year);
  for (let m = 0; m < month - 1; m++) n += lengths[m];
  return CIVIL_EPOCH_JD + n + day - 1;
}

function jdToGregorian(jd: number): Date {
  // Fliegel–Van Flandern, for the proleptic Gregorian calendar.
  const l = jd + 68569;
  const n = Math.floor((4 * l) / 146097);
  const l2 = l - Math.floor((146097 * n + 3) / 4);
  const i = Math.floor((4000 * (l2 + 1)) / 1461001);
  const l3 = l2 - Math.floor((1461 * i) / 4) + 31;
  const j = Math.floor((80 * l3) / 2447);
  const day = l3 - Math.floor((2447 * j) / 80);
  const l4 = Math.floor(j / 11);
  const month = j + 2 - 12 * l4;
  const year = 100 * (n - 49) + i + l4;
  return new Date(year, month - 1, day);
}

/**
 * Convert a Misri/Hijri date to a Gregorian JS Date whose local fields hold
 * that calendar day — the inverse of gregorianToHijri.
 */
export function hijriToGregorian(date: HijriDate): Date {
  return jdToGregorian(hijriToJD(date));
}

/** Human-readable formatted string, e.g. "11 Safar al-Muzaffar 1448H". */
export function formatHijri(
  { day, month, year }: HijriDate,
  { arabic = false }: { arabic?: boolean } = {}
): string {
  const monthName = arabic ? HIJRI_MONTHS_AR[month - 1] : HIJRI_MONTHS_EN[month - 1];
  return arabic
    ? `${toArabicNumeral(day)} ${monthName} ${toArabicNumeral(year)}هـ`
    : `${day} ${monthName} ${year}H`;
}

/**
 * Build a calendar grid (array of week rows, each with 7 day cells) for a
 * given Gregorian month, with the Hijri date attached to every cell —
 * mirroring the dual Gregorian/Hijri day-cell layout used by community
 * Misri calendars.
 *
 * gregMonth is 1-12.
 */
export function buildMonthGrid(gregYear: number, gregMonth: number): MonthCell[][] {
  const firstOfMonth = new Date(gregYear, gregMonth - 1, 1);
  const startOffset = firstOfMonth.getDay(); // 0 = Sunday
  const daysInMonth = new Date(gregYear, gregMonth, 0).getDate();

  // Annotated rather than inferred: the trailing loop below reads back from
  // cells to find the last date, which makes the inferred element type
  // self-referential.
  const cells: MonthCell[] = [];

  for (let i = 0; i < startOffset; i++) {
    const d = new Date(gregYear, gregMonth - 1, 1 - (startOffset - i));
    cells.push(makeCell(d, false));
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(gregYear, gregMonth - 1, day);
    cells.push(makeCell(d, true));
  }

  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].gregorian;
    const d = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    cells.push(makeCell(d, false));
  }

  const weeks: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function makeCell(date: Date, inCurrentMonth: boolean): MonthCell {
  const hijri = gregorianToHijri(date);
  return { gregorian: date, hijri, inCurrentMonth };
}

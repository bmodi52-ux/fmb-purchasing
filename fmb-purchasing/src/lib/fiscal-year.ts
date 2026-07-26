import { gregorianToHijri } from "@/lib/hijri/hijri.js";

/**
 * FMB's fiscal year runs 1 Shawwal -> the day before the next 1 Shawwal
 * (§8), so a fiscal year is a clean 12 lunar months: Shawwal/Zilqad/Zilhijja
 * of year Y through Muharram..Ramadan of year Y+1. The year label used
 * throughout the app is Y (the Hijri year the fiscal year's Shawwal falls
 * in) — "FY1448" starts 1 Shawwal 1448H.
 *
 * Note: §8 describes the range as "Shawwal -> Sha'ban", which read as
 * literal month names leaves Ramadan uncovered by either adjacent fiscal
 * year. We're treating that as shorthand for "closes out before Ramadan/
 * Eid," and computing a gap-free 12-month year ending at 29/30 Ramadan.
 * Flag if that's not the intended boundary.
 */
const SHAWWAL = 10;

export function fiscalYearHijri(date: Date): number {
  const hijri = gregorianToHijri(date);
  return hijri.month >= SHAWWAL ? hijri.year : hijri.year - 1;
}

/** "1447-48 H" — the fiscal year always spans two Hijri years (§8). */
export function formatFiscalYear(year: number): string {
  const endYy = String((year + 1) % 100).padStart(2, "0");
  return `${year}-${endYy} H`;
}

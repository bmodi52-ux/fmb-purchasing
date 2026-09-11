import { gregorianToHijri } from "@/lib/hijri/hijri";
import { ORG_TIME_ZONE } from "@/lib/format";

/**
 * FMB's fiscal year runs 1 Shawwal -> the day before the next 1 Shawwal,
 * so a fiscal year is a clean 12 lunar months: Shawwal/Zilqad/Zilhijja of
 * year Y through Muharram..Ramadan of year Y+1. The year label used
 * throughout the app is Y (the Hijri year the fiscal year's Shawwal falls
 * in) — "FY1448" starts 1 Shawwal 1448H.
 *
 * SETTLED: SHAWWAL THROUGH RAMADAN
 *
 * The consolidated spec (§8) describes the range as "Shawwal -> Sha'ban",
 * which read as literal month names leaves Ramadan belonging to neither the
 * year before nor the year after. This code has always computed a gap-free
 * twelve months ending at 29/30 Ramadan, and carried a note asking for the
 * boundary to be confirmed.
 *
 * It has now been confirmed: Shawwal through Ramadan is the intended year.
 * "Shawwal -> Sha'ban" in the spec is shorthand for the year closing out
 * before Eid, not a literal final month. The note is resolved and the
 * behaviour is unchanged — what changes is that this is now a decision on the
 * record rather than an assumption nobody had checked.
 */
const SHAWWAL = 10;

/**
 * Today's calendar date in Sydney, as a Date whose *local* fields hold it.
 *
 * The conversion below reads `getDate()`, `getMonth()` and `getFullYear()`,
 * which are local-time accessors. On Vercel that local time is UTC, so for the
 * ten or eleven hours each morning that Sydney is already on the next day,
 * `new Date()` yielded yesterday. Almost always harmless — but on 1 Shawwal it
 * puts the whole app in the previous fiscal year, which is the one day of the
 * year it must not.
 */
export function todayInOrgZone(): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ORG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(get("year"), get("month") - 1, get("day"));
}

/**
 * A `YYYY-MM-DD` string as a Date holding exactly that calendar day.
 *
 * `new Date("2026-09-06")` is parsed as UTC midnight, so its local fields are
 * only the 6th in zones at or ahead of UTC. Receipt dates are calendar days
 * with no time; this keeps them that way regardless of where the code runs.
 */
export function parsePlainDate(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function fiscalYearHijri(date: Date): number {
  const hijri = gregorianToHijri(date);
  return hijri.month >= SHAWWAL ? hijri.year : hijri.year - 1;
}

/** The fiscal year in progress right now, in Sydney. */
export function currentFiscalYearHijri(): number {
  return fiscalYearHijri(todayInOrgZone());
}

/**
 * The fiscal year an expense belongs to, from its receipt date, falling back
 * to today when the receipt carried no date.
 */
export function fiscalYearForReceipt(receiptDate: string | null): number {
  const parsed = receiptDate ? parsePlainDate(receiptDate) : null;
  return fiscalYearHijri(parsed ?? todayInOrgZone());
}

/** "1447-48 H" — the fiscal year always spans two Hijri years (§8). */
export function formatFiscalYear(year: number): string {
  const endYy = String((year + 1) % 100).padStart(2, "0");
  return `${year}-${endYy} H`;
}

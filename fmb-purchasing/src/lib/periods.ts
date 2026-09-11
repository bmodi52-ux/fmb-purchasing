import { gregorianToHijri, hijriToGregorian } from "@/lib/hijri/hijri";
import { fiscalYearHijri, formatFiscalYear } from "@/lib/fiscal-year";

/**
 * The periods every page that works by year can be set to (scratchpad #22).
 *
 * FMB runs on the Hijri fiscal year, 1 Shawwal to the end of Ramadan. The GST
 * return and anything statutory run on the Australian financial year, 1 July
 * to 30 June, which cuts across two Hijri years. Some questions are simply
 * about a calendar year. So a period is one of:
 *
 *   h1448            Hijri fiscal year 1448-49 H
 *   au2026           Australian financial year 2026-27 (from 1 July 2026)
 *   cy2026           calendar year 2026
 *   …-q2, …-m3       a quarter or month of any of those, counted from the
 *                    start of that year — Hijri Q1 is Shawwal to Zilhaj,
 *                    Australian Q1 is July to September, matching BAS quarters
 *   r2026-07-01_2026-09-30   any range, inclusive
 *   h-ytd, au-ytd, cy-ytd, last12   so far this year, the last twelve months
 *   h-current, au-current, cy-current   whichever year is current when read,
 *                    so a saved dashboard widget rolls over by itself
 *
 * The code is what goes in the page address, so a link, a saved report view
 * and the Back button all keep the period. Everything here is pure and works
 * in plain `YYYY-MM-DD` calendar days, never in instants, so no time zone can
 * move a boundary.
 */

export type CalendarKind = "hijri" | "au" | "cy";

/**
 * The value for "every period", on the pages that allow it.
 *
 * Lives here rather than beside the picker: that file is "use client", and a
 * server component importing a plain value from a client module gets a
 * client-reference proxy instead of the string, so comparing against it
 * silently never matches.
 */
export const ALL_TIME = "all";

export type PeriodPart =
  | { type: "year" }
  | { type: "quarter"; quarter: 1 | 2 | 3 | 4 }
  | { type: "month"; month: number };

export type Period = {
  code: string;
  /** Null for a custom range, "so far" or the last twelve months. */
  calendar: CalendarKind | null;
  /** The year label number — the Hijri year its Shawwal falls in, or the Gregorian year it starts in. */
  year: number | null;
  part: PeriodPart;
  /** Inclusive, `YYYY-MM-DD`. */
  start: string;
  end: string;
  label: string;
};

export const CALENDAR_LABELS: Record<CalendarKind, string> = {
  hijri: "Hijri year",
  au: "Financial year (Jul–Jun)",
  cy: "Calendar year",
};

const CURRENT_LABELS: Record<CalendarKind, string> = {
  hijri: "This Hijri year",
  au: "This financial year",
  cy: "This calendar year",
};

const HIJRI_MONTH_SHORT = [
  "Muharram", "Safar", "Rabi al-Awwal", "Rabi al-Aakhar", "Jumada al-Ula", "Jumada al-Ukhra",
  "Rajab", "Shabaan", "Ramadan", "Shawwal", "Zilqad", "Zilhaj",
];

const GREGORIAN_MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const GREGORIAN_MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/* ------------------------------------------------------------------ */
/* Calendar days as strings                                            */
/* ------------------------------------------------------------------ */

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** A Date's *local* fields as `YYYY-MM-DD` — the shape hijri.ts and fiscal-year.ts use. */
export function isoFromLocal(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localFromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function utcDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function addDays(iso: string, days: number): string {
  const date = new Date((utcDay(iso) + days) * 86_400_000);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Days from `start` to `end`, both included. */
export function dayCount(start: string, end: string): number {
  return utcDay(end) - utcDay(start) + 1;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return addDays(value, 0) === value;
}

function lastDayOfGregorianMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/* ------------------------------------------------------------------ */
/* The twelve months of a year, in each calendar                       */
/* ------------------------------------------------------------------ */

type MonthSpan = { start: string; end: string; label: string; short: string };

/** Month `index` (1–12, counted from the start of the year) of a year of this kind. */
export function monthOf(calendar: CalendarKind, year: number, index: number): MonthSpan {
  if (calendar === "hijri") {
    // Shawwal is month 10; the fiscal year's first three months fall in year Y.
    const hijriMonth = ((9 + index - 1) % 12) + 1;
    const hijriYear = index <= 3 ? year : year + 1;
    const start = isoFromLocal(hijriToGregorian({ year: hijriYear, month: hijriMonth, day: 1 }));
    const nextMonth = hijriMonth === 12 ? 1 : hijriMonth + 1;
    const nextYear = hijriMonth === 12 ? hijriYear + 1 : hijriYear;
    const end = addDays(isoFromLocal(hijriToGregorian({ year: nextYear, month: nextMonth, day: 1 })), -1);
    const short = HIJRI_MONTH_SHORT[hijriMonth - 1];
    return { start, end, label: `${short} ${hijriYear}`, short };
  }

  const firstMonth = calendar === "au" ? 7 : 1;
  const month = ((firstMonth - 1 + index - 1) % 12) + 1;
  const gYear = calendar === "au" && month < 7 ? year + 1 : year;
  const start = `${pad(gYear, 4)}-${pad(month)}-01`;
  const end = `${pad(gYear, 4)}-${pad(month)}-${pad(lastDayOfGregorianMonth(gYear, month))}`;
  const short = GREGORIAN_MONTH_SHORT[month - 1];
  return { start, end, label: `${GREGORIAN_MONTH_LONG[month - 1]} ${gYear}`, short };
}

export function yearLabel(calendar: CalendarKind, year: number): string {
  if (calendar === "hijri") return formatFiscalYear(year);
  if (calendar === "au") return `FY ${year}–${pad((year + 1) % 100)}`;
  return String(year);
}

/** The year of this kind that `iso` falls in. */
export function yearContaining(calendar: CalendarKind, iso: string): number {
  if (calendar === "hijri") return fiscalYearHijri(localFromIso(iso));
  const [y, m] = iso.split("-").map(Number);
  return calendar === "au" ? (m >= 7 ? y : y - 1) : y;
}

function yearSpan(calendar: CalendarKind, year: number): { start: string; end: string } {
  return { start: monthOf(calendar, year, 1).start, end: monthOf(calendar, year, 12).end };
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

const PREFIX: Record<string, CalendarKind> = { h: "hijri", au: "au", cy: "cy" };
const PREFIX_OF: Record<CalendarKind, string> = { hijri: "h", au: "au", cy: "cy" };

export function formatRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(utcDay(iso) * 86_400_000).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

/** The same range in Hijri dates, e.g. "16 Muharram 1448 – 25 Muharram 1449 H". */
export function formatRangeHijri(start: string, end: string): string {
  const fmt = (iso: string) => {
    const h = gregorianToHijri(localFromIso(iso));
    return { text: `${h.day} ${HIJRI_MONTH_SHORT[h.month - 1]}`, year: h.year };
  };
  const a = fmt(start);
  const b = fmt(end);
  return `${a.text} ${a.year} – ${b.text} ${b.year} H`;
}

function yearPeriod(calendar: CalendarKind, year: number, part: PeriodPart, code: string): Period {
  const yl = yearLabel(calendar, year);
  if (part.type === "year") return { code, calendar, year, part, ...yearSpan(calendar, year), label: yl };
  if (part.type === "quarter") {
    const first = monthOf(calendar, year, (part.quarter - 1) * 3 + 1);
    const last = monthOf(calendar, year, part.quarter * 3);
    return {
      code,
      calendar,
      year,
      part,
      start: first.start,
      end: last.end,
      label: `Q${part.quarter} ${yl} (${first.short}–${last.short})`,
    };
  }
  const month = monthOf(calendar, year, part.month);
  return { code, calendar, year, part, start: month.start, end: month.end, label: month.label };
}

export function periodCode(calendar: CalendarKind, year: number, part: PeriodPart = { type: "year" }): string {
  const base = `${PREFIX_OF[calendar]}${year}`;
  if (part.type === "quarter") return `${base}-q${part.quarter}`;
  if (part.type === "month") return `${base}-m${part.month}`;
  return base;
}

export function rangeCode(start: string, end: string): string {
  return `r${start}_${end}`;
}

/**
 * The period a code names, as at `today`. Anything unreadable falls back to
 * the current Hijri year, which is what every page opens on.
 */
export function parsePeriod(code: string | null | undefined, today: string): Period {
  const fallback = (): Period => {
    const year = yearContaining("hijri", today);
    return yearPeriod("hijri", year, { type: "year" }, periodCode("hijri", year));
  };
  if (!code) return fallback();

  const fixed = /^(h|au|cy)(\d{4})(?:-(q[1-4]|m(?:[1-9]|1[0-2])))?$/.exec(code);
  if (fixed) {
    const calendar = PREFIX[fixed[1]];
    const year = Number(fixed[2]);
    const part: PeriodPart = !fixed[3]
      ? { type: "year" }
      : fixed[3].startsWith("q")
        ? { type: "quarter", quarter: Number(fixed[3].slice(1)) as 1 | 2 | 3 | 4 }
        : { type: "month", month: Number(fixed[3].slice(1)) };
    return yearPeriod(calendar, year, part, code);
  }

  const relative = /^(h|au|cy)-(current|ytd)$/.exec(code);
  if (relative) {
    const calendar = PREFIX[relative[1]];
    const year = yearContaining(calendar, today);
    const whole = yearPeriod(calendar, year, { type: "year" }, code);
    if (relative[2] === "current") return { ...whole, label: `${CURRENT_LABELS[calendar]} (${whole.label})` };
    return {
      code,
      calendar: null,
      year: null,
      part: { type: "year" },
      start: whole.start,
      end: today,
      label: `${whole.label} so far`,
    };
  }

  if (code === "last12") {
    return {
      code,
      calendar: null,
      year: null,
      part: { type: "year" },
      start: addDays(today, -364),
      end: today,
      label: "Last 12 months",
    };
  }

  const range = /^r(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(code);
  if (range && isIsoDate(range[1]) && isIsoDate(range[2]) && range[1] <= range[2]) {
    return {
      code,
      calendar: null,
      year: null,
      part: { type: "year" },
      start: range[1],
      end: range[2],
      label: formatRange(range[1], range[2]),
    };
  }

  // The fiscal-year parameter every page used before #22, so old links and
  // bookmarks still land on the year they meant.
  if (/^\d{4}$/.test(code)) return parsePeriod(`h${code}`, today);

  return fallback();
}

/**
 * The period before this one, for "compared with". A year steps back a year,
 * a quarter a quarter, a month a month, all in the same calendar. A range of
 * any other kind compares with the equally long range just before it — except
 * "so far this year", which compares with the same stretch of last year.
 */
export function previousPeriod(period: Period, today: string): Period {
  if (period.calendar && period.year !== null) {
    const { calendar, year, part } = period;
    if (part.type === "year") return parsePeriod(periodCode(calendar, year - 1), today);
    if (part.type === "quarter") {
      return part.quarter === 1
        ? parsePeriod(periodCode(calendar, year - 1, { type: "quarter", quarter: 4 }), today)
        : parsePeriod(periodCode(calendar, year, { type: "quarter", quarter: (part.quarter - 1) as 1 | 2 | 3 }), today);
    }
    return part.month === 1
      ? parsePeriod(periodCode(calendar, year - 1, { type: "month", month: 12 }), today)
      : parsePeriod(periodCode(calendar, year, { type: "month", month: part.month - 1 }), today);
  }

  const ytd = /^(h|au|cy)-ytd$/.exec(period.code);
  if (ytd) {
    const calendar = PREFIX[ytd[1]];
    const last = yearPeriod(calendar, yearContaining(calendar, period.start) - 1, { type: "year" }, "");
    const end = addDays(last.start, dayCount(period.start, period.end) - 1);
    return {
      code: rangeCode(last.start, end),
      calendar: null,
      year: null,
      part: { type: "year" },
      start: last.start,
      end,
      label: `${last.label}, same stretch`,
    };
  }

  const length = dayCount(period.start, period.end);
  const end = addDays(period.start, -1);
  const start = addDays(end, -(length - 1));
  return parsePeriod(rangeCode(start, end), today);
}

/** Whether a calendar day falls in the period. */
export function inPeriod(period: Pick<Period, "start" | "end">, iso: string): boolean {
  return iso >= period.start && iso <= period.end;
}

/**
 * Years of this kind to offer, newest first: from the year holding the
 * earliest record to the current one.
 */
export function yearsToOffer(calendar: CalendarKind, earliest: string | null, today: string): number[] {
  const current = yearContaining(calendar, today);
  const first = earliest ? Math.min(yearContaining(calendar, earliest), current) : current;
  const years: number[] = [];
  for (let y = current; y >= first; y--) years.push(y);
  return years;
}

/** The parts of a year to offer: whole year, four quarters, twelve months. */
export function partsOfYear(calendar: CalendarKind, year: number): { part: PeriodPart; label: string }[] {
  const out: { part: PeriodPart; label: string }[] = [{ part: { type: "year" }, label: "Whole year" }];
  for (let q = 1 as 1 | 2 | 3 | 4; q <= 4; q = (q + 1) as 1 | 2 | 3 | 4) {
    const first = monthOf(calendar, year, (q - 1) * 3 + 1);
    const last = monthOf(calendar, year, q * 3);
    out.push({ part: { type: "quarter", quarter: q }, label: `Q${q} (${first.short}–${last.short})` });
    if (q === 4) break;
  }
  for (let m = 1; m <= 12; m++) out.push({ part: { type: "month", month: m }, label: monthOf(calendar, year, m).label });
  return out;
}

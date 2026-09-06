/**
 * Where this organisation is, and therefore what "today" and "3pm" mean.
 *
 * This is not cosmetic. Vercel runs Node in UTC, and these formatters are
 * called from server components — the expense detail page, the notification
 * list, the admin error log — so without a zone they rendered every timestamp
 * in UTC. Sydney is ten or eleven hours ahead, which put an expense submitted
 * at 8am Monday on screen as 10pm Sunday: the wrong time, the wrong day, and
 * on the audit trail of a financial record.
 *
 * It also caused a second, quieter fault. The same call rendered in UTC on the
 * server and in the viewer's own zone in the browser, which is a hydration
 * mismatch — React replaces the text after load, so the timestamp visibly
 * changes a moment after the page appears.
 */
export const ORG_TIME_ZONE = "Australia/Sydney";

/**
 * Explicit locale everywhere dates are rendered — toLocaleDateString()
 * without one depends on the runtime's default locale, which differs
 * between the Node server and the browser and causes hydration mismatches.
 * The zone is explicit for the same reason, and for the one above.
 */
export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-AU", { timeZone: ORG_TIME_ZONE });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleString("en-AU", { timeZone: ORG_TIME_ZONE });
}

/**
 * A date read off a receipt, normalised to `YYYY-MM-DD` for a date input.
 *
 * Never `new Date(string)`. That was the previous implementation and it is
 * wrong in two different ways on the same receipts, both silently:
 *
 *   new Date("27/06/2026")  ->  Invalid Date  ->  the date was dropped, and
 *                               the submitter had to retype it
 *   new Date("02/07/2026")  ->  7 February 2026, because V8 reads a slashed
 *                               date as US month-first
 *
 * Australian receipts print day first. The second case is the dangerous one:
 * it produces a valid, plausible, wrong date, which files the expense in the
 * wrong month and can land it in the wrong Hijri fiscal year. Found by
 * scripts/compare-extraction.mjs against real receipts.
 *
 * The extraction prompt now asks for ISO directly, so the day-first branch is
 * a safety net for a model that transcribes what it sees anyway — and for
 * anything else pasted in by hand.
 */
export function normalizeReceiptDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return isRealDate(+iso[1]!, +iso[2]!, +iso[3]!) ? text : "";

  // Day-first, the Australian convention: 2/7/2026 and 02-07-2026 are 2 July.
  const dayFirst = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(text);
  if (dayFirst) {
    const [, d, m, y] = dayFirst;
    if (!isRealDate(+y!, +m!, +d!)) return "";
    return `${y}-${String(+m!).padStart(2, "0")}-${String(+d!).padStart(2, "0")}`;
  }

  // Anything else — "11/07/2026 and 16/07/2026", a written month, a partial
  // date — is left for a person rather than guessed at.
  return "";
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * A plain `YYYY-MM-DD` from the database, rendered as that same date.
 *
 * `receipt_date` and `payment_date` are Postgres `date` columns — a calendar
 * day with no time and no zone. `new Date("2026-09-06")` reads that as UTC
 * midnight, so formatting it in Sydney would shift it to the 6th at 10am,
 * which is harmless, while formatting it anywhere west of Greenwich would
 * shift it back to the 5th, which is not. Rendering the parts directly avoids
 * making a calendar day depend on a clock at all.
 */
export function formatPlainDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!match) return formatDate(isoDate);
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

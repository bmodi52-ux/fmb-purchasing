/**
 * The week a procurement page opens on (#73).
 *
 * Buying is weekly: the lists are drawn up for the days ahead and the trip is
 * made once. So the pages open on this week — Monday to Sunday, because that
 * is how the kitchen talks about a week — and a pair of arrows steps back and
 * forward. A range that is not a whole week is still allowed, typed into the
 * two date boxes; the arrows then step from wherever it starts.
 *
 * Plain strings and plain arithmetic, with no timezone in sight: a service
 * date is a day, not an instant, and `new Date("2026-09-21")` is midnight UTC,
 * which is the previous evening here.
 */

export type DateRange = { from: string; to: string };

const DAY_MS = 86_400_000;

/** YYYY-MM-DD for a local date, since a day is a day wherever it is read. */
export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function shift(iso: string, days: number): string {
  const d = new Date(parse(iso).getTime() + days * DAY_MS);
  return d.toISOString().slice(0, 10);
}

/** The Monday-to-Sunday week a day falls in. */
export function weekOf(iso: string): DateRange {
  const day = parse(iso).getUTCDay(); // 0 Sunday … 6 Saturday
  const back = day === 0 ? 6 : day - 1; // Sunday belongs to the week just gone
  const from = shift(iso, -back);
  return { from, to: shift(from, 6) };
}

/** The same range, moved whole weeks: −1 is last week, 1 is next. */
export function shiftWeeks(range: DateRange, weeks: number): DateRange {
  return { from: shift(range.from, weeks * 7), to: shift(range.to, weeks * 7) };
}

/** Whether a range is exactly one Monday-to-Sunday week. */
export function isWholeWeek(range: DateRange): boolean {
  const week = weekOf(range.from);
  return week.from === range.from && week.to === range.to;
}

/**
 * What to call the week on screen: "This week", "Last week", "Next week", or
 * the dates themselves once it is further off than that.
 */
export function weekLabel(range: DateRange, today: string): string {
  if (!isWholeWeek(range)) return "Custom range";
  const here = weekOf(today);
  const weeks = Math.round((parse(range.from).getTime() - parse(here.from).getTime()) / (7 * DAY_MS));
  if (weeks === 0) return "This week";
  if (weeks === -1) return "Last week";
  if (weeks === 1) return "Next week";
  return `${weeks > 0 ? "In" : ""} ${Math.abs(weeks)} weeks${weeks < 0 ? " ago" : ""}`.trim();
}

/**
 * The range a page should show: what was asked for, or this week when nothing
 * was, or was asked for in a way a URL should not be trusted to get right.
 */
export function rangeFromParams(
  params: { from?: string; to?: string },
  today: string
): DateRange {
  const looksLikeADate = (value: string | undefined): value is string => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");
  if (looksLikeADate(params.from) && looksLikeADate(params.to) && params.from <= params.to) {
    return { from: params.from, to: params.to };
  }
  return weekOf(today);
}

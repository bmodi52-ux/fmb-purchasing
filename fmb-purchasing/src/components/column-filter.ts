/**
 * What a column filter is, and whether a value passes it.
 *
 * Split out of the table component and kept pure so the rules can be tested
 * without rendering anything. The table's job is to draw the menu; deciding
 * what "matches" means is arithmetic, and arithmetic about money and dates is
 * where this application keeps being bitten.
 *
 * The filters used to be one substring box per column. That is fine for
 * hunting a known invoice number and useless for the questions people
 * actually bring to these tables — "just the submitted ones", "everything over
 * five hundred dollars", "these three vendors" — none of which a substring can
 * express. Hence a value picker and a range, chosen per column by what the
 * column contains.
 */

export type ColumnFilter =
  /** A set of exact values to keep. Empty set means "no filter", not "nothing". */
  | { type: "values"; values: string[] }
  /** An inclusive numeric range; either end may be open. */
  | { type: "range"; min: number | null; max: number | null }
  /** An inclusive date range over ISO-ish strings; either end may be open. */
  | { type: "dates"; from: string | null; to: string | null };

export type ColumnFilters = Record<string, ColumnFilter>;

/**
 * Money as these tables render it: "$5,760.00", "-$9.20", "1,944".
 *
 * Returns null rather than NaN so callers can tell "not a number" from
 * "zero" — a distinction that decides whether a column gets a range filter at
 * all, and one that Number("") getting 0 would quietly destroy.
 */
export function parseNumeric(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** ISO first, because that is what sortValue hands back for date columns. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
/** Then the Australian rendering these tables actually print. */
const AU_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;

/**
 * A comparable date key, or null.
 *
 * Australian receipts print day first, and this application has had to be
 * explicit about that everywhere else too — 02/07/2026 is 2 July, never
 * 7 February. Getting it wrong here would silently filter the wrong months
 * into a report.
 */
export function parseDateKey(value: string): string | null {
  const trimmed = value.trim();
  if (ISO_DATE.test(trimmed)) return trimmed.slice(0, 10);
  const au = AU_DATE.exec(trimmed);
  if (!au) return null;
  const [, d, m, y] = au;
  return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}

/**
 * Which kind of filter a column should offer, decided from its own values.
 *
 * Inferred rather than declared, so the four tables using this component pick
 * it up without each having to annotate every column — and so a column whose
 * contents change kind cannot end up with a filter that no longer suits it.
 * Blanks are ignored throughout: a column of amounts with one empty cell is
 * still a column of amounts.
 */
export function inferFilterKind(values: string[]): "values" | "range" | "dates" {
  const present = values.filter((v) => v.trim() !== "");
  if (present.length === 0) return "values";

  if (present.every((v) => parseDateKey(v) !== null)) return "dates";

  // A value list beats a range while there are few enough distinct values to
  // tick: statuses stored as numbers, or a year column, are far easier to pick
  // from than to bracket.
  const distinct = new Set(present).size;
  if (present.every((v) => parseNumeric(v) !== null) && distinct > VALUE_LIST_LIMIT) {
    return "range";
  }
  return "values";
}

/**
 * Above this many distinct values, ticking boxes stops being the easier
 * gesture. Chosen to keep genuinely enumerable columns — statuses, kinds,
 * a handful of submitters — as lists, while amounts become ranges.
 */
export const VALUE_LIST_LIMIT = 12;

/** Whether one cell passes one filter. */
export function matchesFilter(raw: string, filter: ColumnFilter): boolean {
  if (filter.type === "values") {
    // An empty selection is the absence of a filter. Treating it as "match
    // nothing" would blank the table the moment somebody unticked the last box
    // on their way to ticking a different one.
    if (filter.values.length === 0) return true;
    return filter.values.includes(raw);
  }

  if (filter.type === "range") {
    const n = parseNumeric(raw);
    if (n === null) return false;
    if (filter.min !== null && n < filter.min) return false;
    if (filter.max !== null && n > filter.max) return false;
    return true;
  }

  const key = parseDateKey(raw);
  if (key === null) return false;
  if (filter.from && key < filter.from) return false;
  if (filter.to && key > filter.to) return false;
  return true;
}

/** Whether a filter would actually exclude anything. */
export function isActive(filter: ColumnFilter | undefined): boolean {
  if (!filter) return false;
  if (filter.type === "values") return filter.values.length > 0;
  if (filter.type === "range") return filter.min !== null || filter.max !== null;
  return Boolean(filter.from || filter.to);
}

/** How many columns are narrowing the table, for the toolbar's count. */
export function activeCount(filters: ColumnFilters): number {
  return Object.values(filters).filter(isActive).length;
}

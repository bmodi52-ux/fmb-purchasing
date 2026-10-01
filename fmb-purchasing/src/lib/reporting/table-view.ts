/**
 * Sorting and paging a report's table — the same for every table on every
 * report, on the server or in the browser. Pure.
 *
 * A table that can be long (every line behind a figure) is sorted and cut to
 * a page on the server, from the address: `sort`, `dir`, `page`. Only that
 * page crosses the network, so a year of lines costs what fifty do. A table
 * that is short is sent whole and sorted where it is read. Both use these
 * functions, so a column sorts the same way either way.
 */

import type { ColumnKind, ReportCell, ReportColumn, ReportTable } from "./tables.ts";

export const PAGE_SIZE = 50;

export type SortState = { key: string; dir: "asc" | "desc" } | null;

export type TableState = { sort: SortState; page: number };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** A table's state as an address carries it. Anything unreadable is the table as it comes, page one. */
export function tableStateFrom(params: Params): TableState {
  const key = one(params.sort);
  const page = Number.parseInt(one(params.page) ?? "1", 10);
  return {
    sort: key && key.length <= 64 ? { key, dir: one(params.dir) === "asc" ? "asc" : "desc" } : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

const isNumeric = (kind: ColumnKind) => kind !== "text" && kind !== "date";

// One collator, kept: building one per comparison is most of what a sort of
// a long text column would cost.
const collator = new Intl.Collator("en-AU", { numeric: true, sensitivity: "base" });

/** Ascending order of two cells of one column. Dates are ISO days, which order as plain text. */
export function compareCells(a: ReportCell, b: ReportCell, kind: ColumnKind): number {
  if (isNumeric(kind)) return Number(a) - Number(b);
  if (kind === "date") return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  return collator.compare(String(a), String(b));
}

const blank = (v: ReportCell | undefined) => v === null || v === undefined || v === "";

/**
 * Rows in a column's order. Blanks go last whichever way it is sorted — an
 * empty cell is not the smallest amount — and rows that tie keep the order
 * they came in, which is the report's own.
 */
export function sortRows<R extends Record<string, ReportCell>>(rows: R[], columns: ReportColumn[], sort: SortState): R[] {
  const column = sort && columns.find((c) => c.key === sort.key);
  if (!sort || !column) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((x, y) => {
      const a = x.row[column.key];
      const b = y.row[column.key];
      if (blank(a) || blank(b)) return blank(a) === blank(b) ? x.index - y.index : blank(a) ? 1 : -1;
      return sign * compareCells(a, b, column.kind) || x.index - y.index;
    })
    .map((x) => x.row);
}

/**
 * What a click on a column's heading does: sort by it — words A to Z,
 * figures and dates largest and latest first, since that is what is being
 * looked for — then the other way, then back to the report's own order.
 */
export function nextSort(current: SortState, column: Pick<ReportColumn, "key" | "kind">): SortState {
  const first: "asc" | "desc" = column.kind === "text" ? "asc" : "desc";
  if (!current || current.key !== column.key) return { key: column.key, dir: first };
  if (current.dir === first) return { key: column.key, dir: first === "asc" ? "desc" : "asc" };
  return null;
}

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** A page number that exists: past the end is the last page, not an empty one. */
export function clampPage(page: number, total: number, size = PAGE_SIZE): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), pageCount(total, size));
}

export type TablePage<R> = {
  rows: R[];
  /** How many rows there are in all. */
  total: number;
  page: number;
  pages: number;
  /** The first and last row shown, counted from one; 0 and 0 when there are none. */
  from: number;
  to: number;
  /** The sort actually applied: null when the address named a column the table lacks. */
  sort: SortState;
};

/** One page of rows, sorted. */
export function pageOfRows<R extends Record<string, ReportCell>>(
  rows: R[],
  columns: ReportColumn[],
  state: TableState,
  size = PAGE_SIZE
): TablePage<R> {
  const sort = state.sort && columns.some((c) => c.key === state.sort!.key) ? state.sort : null;
  const sorted = sortRows(rows, columns, sort);
  const page = clampPage(state.page, sorted.length, size);
  const start = (page - 1) * size;
  const shown = sorted.slice(start, start + size);
  return {
    rows: shown,
    total: sorted.length,
    page,
    pages: pageCount(sorted.length, size),
    from: shown.length ? start + 1 : 0,
    to: start + shown.length,
    sort,
  };
}

/** A table cut to one page, for sending to the browser; its totals are of every row, as before. */
export function pageOfTable(table: ReportTable, state: TableState, size = PAGE_SIZE): { table: ReportTable; view: Omit<TablePage<never>, "rows"> } {
  const { rows, ...view } = pageOfRows(table.rows, table.columns, state, size);
  return { table: { ...table, rows }, view };
}

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/** A cell as a page shows it. */
export function formatCell(value: ReportCell | undefined, column: Pick<ReportColumn, "kind" | "signed">): string {
  if (blank(value)) return column.kind === "text" ? "" : "—";
  if (typeof value === "string") {
    const day = column.kind === "date" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    return day ? `${day[3]}/${day[2]}/${day[1]}` : value;
  }
  const n = value as number;
  switch (column.kind) {
    case "money":
      return column.signed && n > 0 ? `+${money(n)}` : money(n);
    case "percent":
      return `${Math.round(n * 100)}%`;
    case "count":
      return n.toLocaleString("en-AU");
    case "number":
      return n.toLocaleString("en-AU", { maximumFractionDigits: 4 });
    default:
      return String(n);
  }
}

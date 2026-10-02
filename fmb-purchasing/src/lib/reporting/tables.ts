/**
 * A report as tables, for the downloads (reports overhaul, P1).
 *
 * Every report that can be downloaded describes itself as one or more of
 * these: typed columns, so a spreadsheet gets real money and date cells
 * rather than text, and the same rows whether the file is CSV or Excel. Built
 * on the server from the same figures the page shows, so a download can never
 * disagree with the screen it was taken from.
 */

import { toCsv } from "@/lib/csv";

export type ColumnKind = "text" | "money" | "count" | "number" | "percent" | "date";

export type ReportColumn = {
  key: string;
  label: string;
  kind: ColumnKind;
  /**
   * On a page, the cell links somewhere: the name of the row field that holds
   * the address (an entry number to its expense, say). Downloads ignore it.
   */
  link?: string;
  /** A difference that can go either way: shown with its sign on a page. */
  signed?: boolean;
  /**
   * On a page, the name of a row field that says the cell deserves the eye:
   * "danger" for what is wrong or overdue, "warn" for what is on its way there.
   */
  tone?: string;
  /**
   * On a page, the cell is a status badge (components/status-badge): the name
   * of the row field that holds the status as the record does — "submitted",
   * "approved" — which decides its colour. Downloads print the cell's words.
   */
  badge?: string;
};

export type ReportCell = string | number | null;

export type ReportTable = {
  /** Also the sheet name in Excel, cut to 31 characters. */
  title: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** A last row of totals, set apart from the others. */
  totals?: Record<string, ReportCell>;
};

/** What a download is: its heading, which basis and filters it is for, and its tables. */
export type ReportDocument = {
  title: string;
  /** Period, filters and basis in words — printed above every table. */
  subtitle: string;
  /** Without an extension. */
  filenameBase: string;
  tables: ReportTable[];
  /**
   * What the filter menus offer for the period — the vendors, categories and
   * items in it — for a page built from this document. Downloads ignore it.
   */
  filterOptions?: {
    vendors?: { value: string; label: string }[];
    categories?: { value: string; label: string }[];
    items?: { value: string; label: string }[];
  };
};

/**
 * A CSV holds one table, so a document's CSV is its first table — the one
 * the page is about — headed by the document's title and subtitle, which a
 * spreadsheet shows as two rows above the data. The Excel file has them all.
 */
export function documentToCsv(doc: ReportDocument): string {
  const table = doc.tables[0];
  if (!table) return toCsv([[doc.title], [doc.subtitle]]);
  const row = (r: Record<string, ReportCell>) => table.columns.map((c) => r[c.key] ?? "");
  return toCsv([
    [doc.title],
    [doc.subtitle],
    [],
    table.columns.map((c) => c.label),
    ...table.rows.map(row),
    ...(table.totals ? [row(table.totals)] : []),
  ]);
}

/** A filename part with nothing a filesystem or header would object to. */
export function safeFilename(text: string): string {
  return text.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "report";
}

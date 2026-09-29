/**
 * The one CSV writer (reports audit, 2d).
 *
 * There were three. Reports and the table exports quoted every cell with
 * JSON.stringify, which escapes a quote as \" — not CSV, where a quote is
 * doubled — so a vendor called Joe's "Best" Meats split across columns in
 * Excel. Neither marked the file as UTF-8, so Excel opened Arabic names as
 * mojibake. And neither stopped a cell starting with = + - or @, which Excel
 * runs as a formula: receipt text is read off photos and typed by hand, so
 * that is text from outside ending up executable on a treasurer's laptop.
 *
 * Only the Xero file got the quoting right. It keeps its exact format here —
 * no BOM, nothing prefixed — because it is read by Xero's importer, not
 * opened in Excel, and a description like "-10% off" must arrive as written.
 */

export type CsvOptions = {
  /**
   * A UTF-8 byte-order mark, which is how Excel knows the file is UTF-8.
   * Without it, anything outside plain ASCII is garbled. Default on.
   */
  bom?: boolean;
  /**
   * Prefix text that Excel would read as a formula with an apostrophe.
   * Numbers are left alone, negative ones included. Default on.
   */
  guardFormulas?: boolean;
};

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** One cell: quoted when it has to be, with any quote inside doubled. */
export function csvCell(value: unknown, { guardFormulas = true }: Pick<CsvOptions, "guardFormulas"> = {}): string {
  if (value == null) return "";
  let text = String(value);
  if (guardFormulas && typeof value === "string" && FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows (the first being the header) as a CSV file's contents, CRLF-separated as the format expects. */
export function toCsv(rows: unknown[][], { bom = true, guardFormulas = true }: CsvOptions = {}): string {
  const body = rows.map((row) => row.map((v) => csvCell(v, { guardFormulas })).join(",")).join("\r\n") + "\r\n";
  return (bom ? "﻿" : "") + body;
}

/**
 * A supplier's price list as a file — CSV or Excel — turned into rows of
 * text the product reader can take a piece at a time (#29).
 *
 * Suppliers lay their lists out every way there is: a column for pack size or
 * the size inside the name, prices with and without GST, a category heading
 * on its own row. Rather than ask someone to map columns, the rows go to the
 * same reader that reads a photographed price list, and come back as
 * products to check.
 */

export const SPREADSHEET_EXTENSIONS = [".csv", ".xlsx"] as const;

export function isPriceListFile(file: { name: string; type: string }): boolean {
  const name = file.name.toLowerCase();
  return (
    SPREADSHEET_EXTENSIONS.some((ext) => name.endsWith(ext)) ||
    file.type === "text/csv" ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

/** CSV text as rows of cells: quoted cells may hold commas, quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Rows with something in them, each cell trimmed and trailing blanks dropped. */
export function tidyRows(rows: string[][]): string[][] {
  return rows
    .map((r) => {
      const cells = r.map((c) => c.replace(/\s+/g, " ").trim());
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      return cells;
    })
    .filter((r) => r.some((c) => c !== ""));
}

const csvCell = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);

/**
 * The rows in pieces small enough to read in one go, the first row — almost
 * always the column headings — repeated at the top of each so every piece
 * makes sense on its own.
 */
export function priceListChunks(rows: string[][], size: number): { text: string; from: number; to: number }[] {
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  const headerLine = header.map(csvCell).join(",");
  if (body.length === 0) return [{ text: headerLine, from: 1, to: 1 }];

  const chunks: { text: string; from: number; to: number }[] = [];
  for (let i = 0; i < body.length; i += size) {
    const part = body.slice(i, i + size);
    chunks.push({
      text: [headerLine, ...part.map((r) => r.map(csvCell).join(","))].join("\n"),
      from: i + 2,
      to: i + 1 + part.length,
    });
  }
  return chunks;
}

/** A cell as text, whatever Excel stored in it — formulas by their result, rich text by its words. */
function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const v = value as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
    if (v.richText) return v.richText.map((t) => t.text).join("");
    if ("result" in v) return cellText(v.result);
    if (typeof v.text === "string") return v.text;
    return "";
  }
  return String(value);
}

/** Every row of every sheet in the file, sheets one after another. */
export async function readPriceListRows(file: { name: string; bytes: ArrayBuffer }): Promise<string[][]> {
  if (file.name.toLowerCase().endsWith(".xlsx")) {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.bytes);
    const rows: string[][] = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const values = row.values as unknown[];
        // ExcelJS numbers columns from 1, leaving index 0 empty.
        rows.push(values.slice(1).map(cellText));
      });
    });
    return tidyRows(rows);
  }
  return tidyRows(parseCsv(new TextDecoder("utf-8").decode(file.bytes)));
}

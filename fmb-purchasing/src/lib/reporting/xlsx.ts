import ExcelJS from "exceljs";
import type { ColumnKind, ReportDocument } from "./tables.ts";

/**
 * A report document as an Excel workbook: one sheet per table, a heading of
 * title and subtitle, money as money and dates as dates — so the figures can
 * be summed, sorted and charted in Excel rather than retyped. Server-side;
 * the browser receives the finished file.
 */

const FORMAT: Partial<Record<ColumnKind, string>> = {
  money: '"$"#,##0.00;[Red]-"$"#,##0.00',
  count: "0",
  number: "#,##0.####",
  percent: "0%",
  date: "dd/mm/yyyy",
};

/** Sheet names are at most 31 characters, unique, and free of : \ / ? * [ ]. */
function sheetName(title: string, taken: Set<string>): string {
  const base = title.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}

function cellValue(value: string | number | null, kind: ColumnKind): string | number | Date | null {
  if (value == null || value === "") return null;
  if (kind === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  return value;
}

export async function documentToXlsx(doc: ReportDocument): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mashk";
  workbook.created = new Date();
  const taken = new Set<string>();

  for (const table of doc.tables.length ? doc.tables : [{ title: doc.title, columns: [], rows: [] }]) {
    const sheet = workbook.addWorksheet(sheetName(table.title, taken));
    sheet.addRow([doc.title]).font = { bold: true, size: 13 };
    sheet.addRow([doc.subtitle]).font = { italic: true, color: { argb: "FF6E6254" } };
    sheet.addRow([]);

    const header = sheet.addRow(table.columns.map((c) => c.label));
    header.font = { bold: true };
    header.border = { bottom: { style: "thin" } };
    const headerRow = header.number;

    const add = (r: Record<string, string | number | null>) =>
      sheet.addRow(table.columns.map((c) => cellValue(r[c.key] ?? null, c.kind)));
    for (const r of table.rows) add(r);
    if (table.totals) {
      const totals = add(table.totals);
      totals.font = { bold: true };
      totals.border = { top: { style: "thin" } };
    }

    table.columns.forEach((c, i) => {
      const column = sheet.getColumn(i + 1);
      column.width = c.kind === "text" ? 32 : 14;
      if (FORMAT[c.kind]) column.numFmt = FORMAT[c.kind]!;
    });
    sheet.views = [{ state: "frozen", ySplit: headerRow }];
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

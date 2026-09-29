import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { FMB_CREAM, FMB_CREAM_ALT, FMB_GOLD, FMB_INK, createBrandedPdf, drawPageNumbers, pdfText } from "@/lib/pdf-brand";
import type { ColumnKind, ReportCell, ReportDocument } from "./tables.ts";

/**
 * A report as a PDF of its tables, made on the server from the same document
 * as its Excel file — text, so it can be searched, selected and read aloud,
 * where Print makes a picture of the screen. Print stays for the charts; this
 * is the figures.
 *
 * It uses the standard PDF fonts, as the All expenses PDF does. They hold
 * Latin-1 only (lib/pdf-brand pdfText): a name in Arabic script is marked as
 * such rather than drawn. None is in the data today (checked 2026-09-30); a
 * font with Arabic letters can be embedded when one is.
 */

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

function cellText(value: ReportCell, kind: ColumnKind): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") {
    if (kind === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    }
    return value;
  }
  switch (kind) {
    case "money":
      return money(value);
    case "percent":
      return `${Math.round(value * 100)}%`;
    case "count":
      return value.toLocaleString("en-AU");
    case "number":
      return value.toLocaleString("en-AU", { maximumFractionDigits: 4 });
    default:
      return String(value);
  }
}

const numeric = (kind: ColumnKind) => kind !== "text" && kind !== "date";

export function documentToPdf(doc: ReportDocument, logoDataUrl: string | null): Uint8Array {
  // Wide tables turn the page.
  const widest = Math.max(0, ...doc.tables.map((t) => t.columns.length));
  const { doc: pdf, pageWidth, pageHeight, headerBottom, fillPageBackground, drawHeader } = createBrandedPdf(
    jsPDF,
    logoDataUrl,
    doc.title,
    doc.subtitle,
    widest > 6 ? "landscape" : "portrait"
  );

  let y = headerBottom + 2;
  const margin = { left: 14, right: 14, top: headerBottom + 2, bottom: 16 };

  if (doc.tables.length === 0) {
    fillPageBackground();
    drawHeader();
    pdf.setFontSize(10);
    pdf.text("Nothing in this report.", margin.left, y + 6);
  }

  doc.tables.forEach((table, i) => {
    // A table's heading goes with it: never alone at the foot of a page.
    if (i > 0 && y > pageHeight - margin.bottom - 30) {
      pdf.addPage();
      y = margin.top;
    }
    if (i === 0 || y === margin.top) {
      fillPageBackground();
      drawHeader();
    }
    pdf.setFont("times", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(...FMB_INK);
    pdf.text(pdfText(table.title), margin.left, y + 5);

    const row = (r: Record<string, ReportCell>) => table.columns.map((c) => pdfText(cellText(r[c.key] ?? null, c.kind)));
    autoTable(pdf, {
      startY: y + 8,
      head: [table.columns.map((c) => pdfText(c.label))],
      body: table.rows.length ? table.rows.map(row) : [[{ content: "Nothing to show.", colSpan: table.columns.length }]],
      foot: table.totals ? [row(table.totals)] : undefined,
      showFoot: "lastPage",
      styles: { fontSize: 8, textColor: FMB_INK, fillColor: FMB_CREAM, lineColor: [225, 210, 180], cellPadding: 1.6 },
      headStyles: { fillColor: FMB_GOLD, textColor: FMB_INK, fontStyle: "bold" },
      footStyles: { fillColor: FMB_CREAM_ALT, textColor: FMB_INK, fontStyle: "bold" },
      alternateRowStyles: { fillColor: FMB_CREAM_ALT },
      columnStyles: Object.fromEntries(
        table.columns.map((c, ci) => [ci, numeric(c.kind) ? { halign: "right" as const } : {}])
      ),
      margin,
      willDrawPage: (data) => {
        // The first page of each table was drawn above; later ones need theirs.
        if (data.pageNumber > 1) {
          fillPageBackground();
          drawHeader();
        }
      },
    });
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  });

  drawPageNumbers(pdf, pageWidth, pageHeight);
  return new Uint8Array(pdf.output("arraybuffer"));
}

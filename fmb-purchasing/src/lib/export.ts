"use client";

import { toCsv } from "@/lib/csv";
import { FMB_CREAM, FMB_CREAM_ALT, FMB_GOLD, FMB_INK, createBrandedPdf, drawPageNumbers, pdfText } from "@/lib/pdf-brand";

export type ExportColumn = { key: string; label: string };

function cellText(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(filename: string, columns: ExportColumn[], rows: Record<string, unknown>[]) {
  const csv = toCsv([columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => r[c.key]))]);
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}

export function exportJson(filename: string, columns: ExportColumn[], rows: Record<string, unknown>[]) {
  const data = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const c of columns) out[c.key] = r[c.key] ?? null;
    return out;
  });
  triggerDownload(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename);
}

export async function exportExcel(filename: string, sheetName: string, columns: ExportColumn[], rows: Record<string, unknown>[]) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: 18 }));
  sheet.getRow(1).font = { bold: true };
  for (const r of rows) {
    sheet.addRow(columns.reduce<Record<string, unknown>>((acc, c) => ({ ...acc, [c.key]: r[c.key] ?? "" }), {}));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(new Blob([buffer], { type: "application/octet-stream" }), filename);
}

let logoDataUrlPromise: Promise<string | null> | null = null;

function loadLogoDataUrl(): Promise<string | null> {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = fetch("/fmb-logo.png")
      .then((res) => res.blob())
      .then(
        (blob) =>
          new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          })
      )
      .catch(() => null);
  }
  return logoDataUrlPromise;
}

export async function exportPdf(filename: string, title: string, columns: ExportColumn[], rows: Record<string, unknown>[]) {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const logoDataUrl = await loadLogoDataUrl();
  const { doc, pageWidth, pageHeight, headerBottom, fillPageBackground, drawHeader } = createBrandedPdf(
    jsPDF,
    logoDataUrl,
    title,
    undefined,
    columns.length > 6 ? "landscape" : "portrait"
  );

  autoTable(doc, {
    startY: headerBottom,
    head: [columns.map((c) => pdfText(c.label))],
    body: rows.map((r) => columns.map((c) => pdfText(cellText(r[c.key])))),
    styles: { fontSize: 8, textColor: FMB_INK, fillColor: FMB_CREAM, lineColor: [225, 210, 180] },
    headStyles: { fillColor: FMB_GOLD, textColor: FMB_INK, fontStyle: "bold" },
    alternateRowStyles: { fillColor: FMB_CREAM_ALT },
    margin: { left: 14, right: 14, top: headerBottom, bottom: 16 },
    willDrawPage: fillPageBackground,
    didDrawPage: drawHeader,
  });

  drawPageNumbers(doc, pageWidth, pageHeight);
  doc.save(filename);
}

/**
 * Rasterizes a hand-picked set of on-screen chart/table elements (whatever
 * filters produced them) into the same branded document family as
 * `exportPdf` — this is "print this dashboard" rather than "export this
 * table," so there's no row data to hand jsPDF, just DOM nodes.
 */
export async function exportWidgetsPdf(
  filename: string,
  title: string,
  subtitle: string,
  widgets: { label: string; element: HTMLElement }[]
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");
  // Tailwind v4's opacity-modifier utilities (e.g. border-ink/10, bg-white/60)
  // resolve to color-mix()/oklab() at the computed-style level, which plain
  // html2canvas can't parse — this fork adds that support.
  const { default: html2canvas } = await import("html2canvas-pro");
  const logoDataUrl = await loadLogoDataUrl();
  const { doc, pageWidth, pageHeight, headerBottom, fillPageBackground, drawHeader } = createBrandedPdf(
    jsPDF,
    logoDataUrl,
    title,
    subtitle,
    "portrait"
  );

  const marginX = 14;
  const bottomMargin = 20;
  const contentWidth = pageWidth - marginX * 2;
  const labelHeight = 6;
  const gapBetween = 10;
  const maxHeightPerPage = pageHeight - bottomMargin - (headerBottom + 4) - labelHeight;

  fillPageBackground();
  drawHeader();
  let y = headerBottom + 4;

  for (const widget of widgets) {
    const canvas = await html2canvas(widget.element, {
      backgroundColor: "#fbf6ec",
      scale: 2,
      useCORS: true,
    });

    let imgWidth = contentWidth;
    let imgHeight = (canvas.height / canvas.width) * imgWidth;
    // A chart taller than a whole page would otherwise have nowhere to go —
    // shrink it (keeping proportions) to fit a single fresh page, rather
    // than trying to split one image across pages.
    if (imgHeight > maxHeightPerPage) {
      imgHeight = maxHeightPerPage;
      imgWidth = (canvas.width / canvas.height) * imgHeight;
    }

    if (y + labelHeight + imgHeight > pageHeight - bottomMargin) {
      doc.addPage();
      fillPageBackground();
      drawHeader();
      y = headerBottom + 4;
    }

    doc.setFont("times", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...FMB_INK);
    doc.text(pdfText(widget.label), marginX, y + 4);
    y += labelHeight;

    doc.addImage(canvas.toDataURL("image/png"), "PNG", marginX, y, imgWidth, imgHeight);
    y += imgHeight + gapBetween;
  }

  drawPageNumbers(doc, pageWidth, pageHeight);
  doc.save(filename);
}

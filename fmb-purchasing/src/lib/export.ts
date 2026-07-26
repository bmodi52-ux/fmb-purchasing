"use client";

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
  const lines = [
    columns.map((c) => JSON.stringify(c.label)).join(","),
    ...rows.map((r) => columns.map((c) => JSON.stringify(cellText(r[c.key]))).join(",")),
  ];
  triggerDownload(new Blob([lines.join("\n")], { type: "text/csv" }), filename);
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

const FMB_CREAM: [number, number, number] = [251, 246, 236];
const FMB_CREAM_ALT: [number, number, number] = [244, 236, 218];
const FMB_GOLD: [number, number, number] = [216, 156, 36];
const FMB_INK: [number, number, number] = [43, 33, 28];

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

// A gentle sine-wave flourish, echoing the palm-frond motif used elsewhere in the app.
function drawWaveDivider(doc: import("jspdf").jsPDF, x: number, y: number, width: number) {
  doc.setDrawColor(...FMB_GOLD);
  doc.setLineWidth(0.25);
  const segments = 36;
  const amplitude = 0.9;
  let prevX = x;
  let prevY = y;
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const px = x + t * width;
    const py = y + Math.sin(t * Math.PI * 2) * amplitude;
    doc.line(prevX, prevY, px, py);
    prevX = px;
    prevY = py;
  }
}

export async function exportPdf(filename: string, title: string, columns: ExportColumn[], rows: Record<string, unknown>[]) {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: columns.length > 6 ? "landscape" : "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const logoDataUrl = await loadLogoDataUrl();
  const HEADER_BOTTOM = 42;

  function fillPageBackground() {
    doc.setFillColor(...FMB_CREAM);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
  }

  function drawHeader() {
    const textX = 14;
    let titleX = textX;
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, "PNG", textX, 9, 15, 15);
        titleX = textX + 19;
      } catch {
        // Corrupt/unsupported image data — fall back to text-only header.
      }
    }

    doc.setFont("times", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...FMB_INK);
    doc.text("FMB Purchasing", titleX, 16);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110, 98, 84);
    doc.text("Faiz ul Mawaid il Burhaniyah", titleX, 21.5);

    doc.setDrawColor(...FMB_GOLD);
    doc.setLineWidth(0.6);
    doc.line(textX, 27, pageWidth - textX, 27);
    drawWaveDivider(doc, textX, 30, 26);

    doc.setFont("times", "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(...FMB_INK);
    doc.text(title, textX, 37.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140, 128, 114);
    doc.text(`Generated ${new Date().toLocaleString("en-AU")}`, pageWidth - textX, 37.5, { align: "right" });
  }

  autoTable(doc, {
    startY: HEADER_BOTTOM,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => cellText(r[c.key]))),
    styles: { fontSize: 8, textColor: FMB_INK, fillColor: FMB_CREAM, lineColor: [225, 210, 180] },
    headStyles: { fillColor: FMB_GOLD, textColor: FMB_INK, fontStyle: "bold" },
    alternateRowStyles: { fillColor: FMB_CREAM_ALT },
    margin: { left: 14, right: 14, top: HEADER_BOTTOM, bottom: 16 },
    willDrawPage: fillPageBackground,
    didDrawPage: drawHeader,
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(150, 138, 122);
    doc.text(`FMB Purchasing · Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 8, { align: "center" });
  }

  doc.save(filename);
}

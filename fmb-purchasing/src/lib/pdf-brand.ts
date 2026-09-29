import type { jsPDF } from "jspdf";
import { ORG_TIME_ZONE } from "@/lib/format";

/**
 * The branded page shell every PDF shares — logo, wordmark, wave divider,
 * title, subtitle and page numbers — whether it is made in the browser (the
 * All expenses export, a printed dashboard) or on the server (a report's
 * download). Takes the jsPDF constructor and the logo rather than loading
 * either, so it runs in both.
 */

const PLAIN: Record<string, string> = {
  "—": "-", // — em dash
  "–": "-", // – en dash
  "−": "-", // − minus
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "›": ">", // › between a parent category and its child
  "•": "·",
  " ": " ",
  " ": " ",
};
const ARABIC_RUN = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+(?:[\s‌‍]+[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]+)*/g;

/**
 * Text as the standard PDF fonts can draw it. They hold Latin-1 and nothing
 * more, and jsPDF drops anything else without a word — every "—" in a
 * report's title, every "–" in "FY 2026–27". Dashes and quotes become their
 * plain forms; Arabic script, which needs an embedded font this app does not
 * yet ship, is marked rather than silently lost; anything else left over
 * becomes "?".
 */
export function pdfText(text: string): string {
  return text
    .replace(ARABIC_RUN, "[Arabic text]")
    .replace(/[—–−‘’“”…›•  ]/g, (c) => PLAIN[c])
    .replace(/[^\u0000-ÿ]/g, "?");
}

export const FMB_CREAM: [number, number, number] = [251, 246, 236];
export const FMB_CREAM_ALT: [number, number, number] = [244, 236, 218];
export const FMB_GOLD: [number, number, number] = [216, 156, 36];
export const FMB_INK: [number, number, number] = [43, 33, 28];

// A gentle sine-wave flourish, echoing the palm-frond motif used elsewhere in the app.
function drawWaveDivider(doc: jsPDF, x: number, y: number, width: number) {
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

/**
 * The FMB-branded page shell (logo, wordmark, wave divider, title, optional
 * subtitle) shared by every PDF export — a row-table export and a
 * rasterized-widgets export otherwise have nothing in common, but they
 * should still look like the same document family.
 */
export function createBrandedPdf(
  jsPDFCtor: typeof jsPDF,
  logoDataUrl: string | null,
  title: string,
  subtitle: string | undefined,
  orientation: "portrait" | "landscape"
) {
  const doc = new jsPDFCtor({ orientation });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const headerBottom = subtitle ? 47 : 42;

  function fillPageBackground() {
    doc.setFillColor(...FMB_CREAM);
    doc.rect(0, 0, pageWidth, pageHeight, "F");
  }

  function drawHeader() {
    const textX = 14;
    let titleX = textX;
    if (logoDataUrl) {
      try {
        // One image, named so every page reuses it, and compressed: jsPDF
        // otherwise stores the logo as raw pixels, most of a small file.
        doc.addImage(logoDataUrl, "PNG", textX, 9, 15, 15, "fmb-logo", "FAST");
        titleX = textX + 19;
      } catch {
        // Corrupt/unsupported image data — fall back to text-only header.
      }
    }

    doc.setFont("times", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...FMB_INK);
    doc.text("FMB Sydney", titleX, 16);

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
    doc.text(pdfText(title), textX, 37.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140, 128, 114);
    doc.text(`Generated ${new Date().toLocaleString("en-AU", { timeZone: ORG_TIME_ZONE })}`, pageWidth - textX, 37.5, { align: "right" });

    if (subtitle) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(110, 98, 84);
      doc.text(pdfText(subtitle), textX, 43);
    }
  }

  return { doc, pageWidth, pageHeight, headerBottom, fillPageBackground, drawHeader };
}

export function drawPageNumbers(doc: jsPDF, pageWidth: number, pageHeight: number) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(150, 138, 122);
    doc.text(`FMB Sydney · Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 8, { align: "center" });
  }
}

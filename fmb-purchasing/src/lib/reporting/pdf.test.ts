import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pdfText as textForPdf } from "@/lib/pdf-brand";
import { documentToPdf } from "./pdf.ts";
import type { ReportDocument } from "./tables.ts";

const pdfSource = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
const pageCount = (bytes: Uint8Array) => (pdfSource(bytes).match(/\/Type \/Page\b/g) ?? []).length;

const doc: ReportDocument = {
  title: "Reports — Breakdown",
  subtitle: "This financial year · By receipt date · submitted, approved and paid",
  filenameBase: "reports-breakdown",
  tables: [
    {
      title: "By category",
      columns: [
        { key: "label", label: "Category", kind: "text" },
        { key: "spend", label: "Spend", kind: "money" },
        { key: "count", label: "Lines", kind: "count" },
        { key: "share", label: "Share", kind: "percent" },
        { key: "on", label: "Last bought", kind: "date" },
      ],
      rows: [
        { label: "Meat & Poultry", spend: 1234.5, count: 12, share: 0.61, on: "2026-07-05" },
        { label: "Bakery", spend: 789, count: 3, share: 0.39, on: null },
      ],
      totals: { label: "Total", spend: 2023.5, count: 15, share: 1 },
    },
  ],
};

describe("documentToPdf", () => {
  test("a PDF with the report's words in it, as text", () => {
    const bytes = documentToPdf(doc, null);
    const text = pdfSource(bytes);
    assert.ok(text.startsWith("%PDF-"));
    // The title's dash survives as a plain one, not dropped.
    for (const words of ["(Reports - Breakdown)", "(By category)", "(Meat & Poultry)", "($1,234.50)", "(61%)", "(Total)", "($2,023.50)"]) {
      assert.ok(text.includes(words), `missing ${words}`);
    }
    assert.match(text, /\(5 Jul(y)? 2026\)/);
    assert.equal(pageCount(bytes), 1);
  });

  test("a long table runs on over pages, each with its own header", () => {
    const long: ReportDocument = {
      ...doc,
      tables: [
        { ...doc.tables[0], rows: Array.from({ length: 150 }, (_, i) => ({ label: `Row ${i}`, spend: i, count: 1, share: 0, on: null })) },
        { ...doc.tables[0], title: "Second table" },
      ],
    };
    const bytes = documentToPdf(long, null);
    assert.ok(pageCount(bytes) >= 3);
    // The brand heading is drawn on every page.
    assert.equal((pdfSource(bytes).match(/Faiz ul Mawaid il Burhaniyah/g) ?? []).length, pageCount(bytes));
    assert.ok(pdfSource(bytes).includes("Second table"));
  });

  test("a report with no rows still makes a file", () => {
    const bytes = documentToPdf({ ...doc, tables: [{ ...doc.tables[0], rows: [], totals: undefined }] }, null);
    assert.ok(pdfSource(bytes).includes("Nothing to show."));
  });
});

describe("pdfText", () => {
  test("dashes, quotes and category arrows come through in their plain forms", () => {
    assert.equal(textForPdf("FY 2026–27 — Meat › Chicken “fresh” … it’s"), `FY 2026-27 - Meat > Chicken "fresh" ... it's`);
  });

  test("Latin-1 stays as it is", () => {
    assert.equal(textForPdf("Café · 50% · $1,234.50"), "Café · 50% · $1,234.50");
  });

  test("Arabic script is marked, not silently dropped", () => {
    assert.equal(textForPdf("Mashk مشک"), "Mashk [Arabic text]");
    assert.equal(textForPdf("Daal چاول نان and rice"), "Daal [Arabic text] and rice");
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mayLackTaxInvoice, summariseGst, xeroTaxType, type GstExpense } from "./gst-summary.ts";
import { buildXeroBillsCsv } from "./xero-export.ts";

const expense = (over: Partial<GstExpense>): GstExpense => ({
  id: "e1",
  expenseNumber: "E-0001",
  vendorName: "Campbells",
  total: 110,
  gst: 10,
  hasAttachment: true,
  vendorAbn: "12345678901",
  vendorGstRegistered: true,
  lateForLockedPeriod: false,
  ...over,
});

describe("summariseGst — #38", () => {
  test("G10, G11 and 1B from the lines", () => {
    const s = summariseGst(
      [expense({}), expense({ id: "e2", total: 2200, gst: 200 })],
      [
        { expenseId: "e1", lineTotal: 110, gst: 10, isCapital: false, gstApportioned: false },
        { expenseId: "e2", lineTotal: 2200, gst: 200, isCapital: true, gstApportioned: false },
        { expenseId: "e-other", lineTotal: 999, gst: 90, isCapital: false, gstApportioned: false },
      ]
    );
    assert.deepEqual([s.g10, s.g11, s.oneB], [2200, 110, 210]);
  });

  test("GST over $82.50 with no receipt or no ABN, and GST from an unregistered vendor, are listed", () => {
    const s = summariseGst(
      [
        expense({ id: "a", hasAttachment: false }),
        expense({ id: "b", vendorAbn: null }),
        expense({ id: "c", total: 50, gst: 4.55, hasAttachment: false }),
        expense({ id: "d", vendorGstRegistered: false }),
      ],
      []
    );
    assert.deepEqual(s.concerns.map((c) => c.expense.id), ["a", "b", "d"]);
    assert.equal(mayLackTaxInvoice({ gst: 0, total: 500, hasAttachment: false, vendorAbn: null }), false);
  });

  test("Xero tax types follow the line's GST and capital flags", () => {
    assert.equal(xeroTaxType({ gst: 10, isCapital: false }), "INPUT");
    assert.equal(xeroTaxType({ gst: 0, isCapital: false }), "EXEMPTEXPENSES");
    assert.equal(xeroTaxType({ gst: 200, isCapital: true }), "CAPEXINPUT");
    assert.equal(xeroTaxType({ gst: 0, isCapital: true }), "EXEMPTCAPITAL");
  });
});

describe("buildXeroBillsCsv", () => {
  test("one row per line, Australian dates, quoted where needed", () => {
    const csv = buildXeroBillsCsv([
      {
        expenseNumber: "E-0012",
        invoiceNumber: "INV, 7",
        contactName: "Taj Mart",
        invoiceDate: "2026-09-01",
        dueDate: "2026-09-15",
        description: 'Rice 25kg "Gold"',
        lineTotal: 45,
        gst: 0,
        isCapital: false,
        accountCode: "400",
      },
    ]);
    const [header, row] = csv.split("\r\n");
    assert.ok(header.startsWith("*ContactName,"));
    assert.equal(row, 'Taj Mart,,"E-0012 / INV, 7",E-0012,01/09/2026,15/09/2026,"Rice 25kg ""Gold""",1,45.00,400,EXEMPTEXPENSES,AUD');
  });
});

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  lineGst,
  lineSubtotal,
  sumLines,
  sumLineGst,
  reconcile,
  gstDiscrepancy,
  storedGstDisagreement,
  suggestedKindForDifference,
  residualFor,
  type MoneyLine,
} from "./expense-money.ts";

const goods = (lineTotal: number, gstApplicable = false): MoneyLine => ({
  kind: "goods",
  lineTotal,
  gstApplicable,
});

/**
 * The figures below are taken from real receipts submitted to FMB, because
 * the failures they cover were found in real receipts rather than imagined.
 */
describe("lineGst", () => {
  test("a GST-free line carries no GST, however large", () => {
    // Costco: 80 x Procal Thick Cream, $591.20, printed GST $0.00. Fresh
    // dairy is GST-free; apportionment used to spread the receipt's GST
    // across lines like this one.
    assert.equal(lineGst(goods(591.2, false)), 0);
  });

  test("a taxable line carries one eleventh of its inclusive amount", () => {
    assert.equal(lineGst(goods(110, true)), 10);
  });

  test("rounds to cents", () => {
    // Aldi credit surcharge, $0.56 inclusive.
    assert.equal(lineGst({ kind: "surcharge", lineTotal: 0.56, gstApplicable: true }), 0.05);
  });

  test("a negative line yields negative GST, so a credit reverses the claim", () => {
    // Campbells invoice 17113 carries -$92.12 and -$23.03 credit lines.
    assert.equal(lineGst(goods(-92.12, true)), -8.37);
  });
});

describe("lineSubtotal", () => {
  test("GST-free line: subtotal is the whole amount", () => {
    assert.equal(lineSubtotal(goods(975, false)), 975);
  });

  test("taxable line: subtotal plus GST returns the inclusive amount", () => {
    const line = goods(110, true);
    assert.equal(lineSubtotal(line) + lineGst(line), 110);
  });
});

describe("reconcile", () => {
  test("a receipt whose lines account for everything is balanced", () => {
    const lines = [goods(13.35), goods(86.16)];
    const result = reconcile(lines, 99.51);
    assert.equal(result.balanced, true);
    assert.equal(result.difference, 0);
  });

  test("Aldi: a card surcharge left off the lines shows as a difference", () => {
    // Lines 13.35 + 86.16 = 99.51; the receipt was charged 100.07 after a
    // 0.50% credit surcharge of 0.56. The old form would have recorded 99.51
    // and reimbursed the submitter 56c short.
    const lines = [goods(13.35), goods(86.16)];
    const result = reconcile(lines, 100.07);
    assert.equal(result.balanced, false);
    assert.equal(result.difference, 0.56);
  });

  test("adding the surcharge as its own line balances it", () => {
    const lines: MoneyLine[] = [
      goods(13.35),
      goods(86.16),
      { kind: "surcharge", lineTotal: 0.56, gstApplicable: true },
    ];
    assert.equal(reconcile(lines, 100.07).balanced, true);
  });

  test("Radhe: a discount is a negative line, not a smaller total", () => {
    // "SUBTOTAL 92.00 / 10 % DISCOUNT 9.20- / TOTAL 82.80"
    const lines: MoneyLine[] = [
      goods(92.0),
      { kind: "discount", lineTotal: -9.2, gstApplicable: false },
    ];
    const result = reconcile(lines, 82.8);
    assert.equal(result.balanced, true);
    assert.equal(result.difference, 0);
  });

  test("the tolerance covers float noise and nothing wider", () => {
    assert.equal(reconcile([goods(0.1), goods(0.2)], 0.3).balanced, true);
    // 5c is a real difference — Australian cash rounding prints as its own
    // line and must be captured, not absorbed.
    assert.equal(reconcile([goods(10)], 10.05).balanced, false);
  });

  test("an empty line list makes the whole total unaccounted for", () => {
    assert.equal(reconcile([], 128).difference, 128);
  });
});

describe("gstDiscrepancy", () => {
  test("returns null when the receipt printed no GST figure", () => {
    assert.equal(gstDiscrepancy([goods(100, true)], null), null);
  });

  test("agrees when the flags reproduce the printed GST", () => {
    // Foodworks marks taxable lines with (*); here one of two is taxable.
    const lines = [goods(110, true), goods(50, false)];
    assert.equal(gstDiscrepancy(lines, 10), 0);
  });

  test("surfaces a taxable line that was not flagged", () => {
    const lines = [goods(110, false), goods(50, false)];
    assert.equal(gstDiscrepancy(lines, 10), 10);
  });

  test("surfaces GST claimed on a receipt that prints none", () => {
    // The failure this whole change exists to prevent: a fresh-meat invoice
    // printing GST $0.00, with a line wrongly flagged taxable.
    const lines = [goods(975, true)];
    assert.equal(gstDiscrepancy(lines, 0), -88.64);
  });
});

describe("storedGstDisagreement", () => {
  test("nothing to compare when the receipt printed no GST", () => {
    assert.equal(storedGstDisagreement(12.5, null, 3), null);
  });

  test("half a cent per taxable line is rounding, not a disagreement", () => {
    // Twelve taxable lines each rounding their own eleventh can drift 6c from
    // GST worked out once on the total.
    assert.equal(storedGstDisagreement(45.0, 45.06, 12), null);
  });

  test("a missed taxable line is a disagreement", () => {
    assert.equal(storedGstDisagreement(0, 10, 1), 10);
    assert.equal(storedGstDisagreement(88.64, 0, 1), -88.64);
  });
});

/**
 * Every case below is a real gap from a real receipt, measured by
 * scripts/compare-extraction.mjs across the FMB receipts folder. The point of
 * the rule is that the submitter should not be asked to do arithmetic the app
 * can do — but should always be asked when the answer is not arithmetic.
 */
describe("residualFor", () => {
  test("balanced lines need no residual at all", () => {
    assert.equal(residualFor([goods(99.51)], 99.51), null);
  });

  test("a small shortfall is booked as a surcharge without asking", () => {
    // Please_pay_Burhanuddin_Modi: lines 1813.87, total 1819.21 — 0.3%.
    const r = residualFor([goods(1813.87)], 1819.21);
    assert.equal(r?.kind, "surcharge");
    assert.equal(r?.reason, "charge");
    assert.equal(r?.amount, 5.34);
  });

  test("a small overshoot is booked as a discount", () => {
    // Fresh_Produce_Invoice: lines 987.00, total 957 — 3.1%.
    const r = residualFor([goods(987)], 957);
    assert.equal(r?.kind, "discount");
    assert.equal(r?.reason, "charge");
    assert.equal(r?.amount, -30);
  });

  test("a gap too large to be a charge is left visible, not guessed at", () => {
    // Please_pay_Taj_Mart: lines 1924.81, total 3021.96 — 36% of the invoice
    // is missing. Booking that as a "surcharge" would hide the failure.
    const r = residualFor([goods(1924.81)], 3021.96);
    assert.equal(r?.kind, "unallocated");
    assert.equal(r?.reason, "unitemised");
  });

  test("a receipt with no line items at all is unallocated, whatever the size", () => {
    // Shehrullah_Sehori: a total of 1165.50 and nothing itemised.
    const r = residualFor([], 1165.5);
    assert.equal(r?.kind, "unallocated");
    assert.equal(r?.amount, 1165.5);
  });

  test("charges alone do not count as itemisation", () => {
    // A receipt read as nothing but a delivery fee has not been itemised.
    const r = residualFor([{ kind: "delivery", lineTotal: 6.99, gstApplicable: true }], 106.99);
    assert.equal(r?.kind, "unallocated");
  });

  test("a service counts as itemisation, so its surcharge is still booked", () => {
    // A cleaning invoice carries no goods at all. Before 'service' existed it
    // had to be entered as goods; now that it need not, the rule has to treat
    // it as substantive too — otherwise a 0.5% card fee on a $450 clean is
    // sent to the review queue for a person to confirm.
    const r = residualFor([{ kind: "service", lineTotal: 450, gstApplicable: true }], 452.25);
    assert.equal(r?.kind, "surcharge");
    assert.equal(r?.reason, "charge");
    assert.equal(r?.amount, 2.25);
  });

  test("a service invoice missing most of its value is still left visible", () => {
    const r = residualFor([{ kind: "service", lineTotal: 200, gstApplicable: true }], 900);
    assert.equal(r?.kind, "unallocated", "being substantive does not make a gap plausible");
  });

  test("the boundary sits between a plausible discount and missing goods", () => {
    // 10% — a real bulk discount, booked automatically.
    assert.equal(residualFor([goods(100)], 90)?.kind, "discount");
    // 20% — too much to assume, so a person decides.
    assert.equal(residualFor([goods(100)], 80)?.kind, "unallocated");
  });

  test("the Aldi surcharge is booked rather than handed to the submitter", () => {
    const r = residualFor([goods(13.35), goods(86.16)], 100.07);
    assert.equal(r?.kind, "surcharge");
    assert.equal(r?.amount, 0.56);
  });
});

describe("suggestedKindForDifference", () => {
  test("more charged than itemised suggests a surcharge", () => {
    assert.equal(suggestedKindForDifference(0.56), "surcharge");
  });

  test("less charged than itemised suggests a discount", () => {
    assert.equal(suggestedKindForDifference(-9.2), "discount");
  });
});

describe("sums", () => {
  test("sumLines adds signed amounts", () => {
    assert.equal(sumLines([goods(92), { kind: "discount", lineTotal: -9.2, gstApplicable: false }]), 82.8);
  });

  test("sumLineGst counts only the flagged lines", () => {
    assert.equal(sumLineGst([goods(110, true), goods(975, false)]), 10);
  });
});

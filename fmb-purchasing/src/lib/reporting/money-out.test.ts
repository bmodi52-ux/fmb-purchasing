import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { orgDay } from "@/lib/format";
import { daysBetween, paymentsMade, paymentsMadeTables, pipeline, waiting, type MoneyExpense } from "./money-out.ts";

let n = 0;
function expense(over: Partial<MoneyExpense> = {}): MoneyExpense {
  n += 1;
  return {
    id: `e${n}`,
    entry: `E-${String(n).padStart(4, "0")}`,
    status: "paid",
    vendor: "Harris Farm",
    payee: "Aliasgar",
    total: 100,
    submittedOn: "2026-07-01",
    decidedOn: "2026-07-03",
    paidOn: "2026-07-10",
    runId: null,
    runNumber: null,
    reference: null,
    bankConfirmedOn: null,
    ...over,
  };
}

describe("daysBetween", () => {
  test("the same day is nought, the next day one", () => {
    assert.equal(daysBetween("2026-07-01", "2026-07-01"), 0);
    assert.equal(daysBetween("2026-07-01", "2026-07-02"), 1);
    assert.equal(daysBetween("2026-06-28", "2026-07-03"), 5);
  });
});

describe("orgDay", () => {
  test("an instant is dated by the day it fell on in Sydney, not in UTC", () => {
    // 23:30 UTC on 30 June is 09:30 on 1 July in Sydney (AEST, +10).
    assert.equal(orgDay("2026-06-30T23:30:00Z"), "2026-07-01");
    assert.equal(orgDay("2026-06-30T13:59:00Z"), "2026-06-30");
  });
});

describe("paymentsMade", () => {
  test("expenses in one payment run are one transfer; an expense paid on its own is another", () => {
    const r = paymentsMade([
      expense({ runId: "run1", runNumber: "PR-0001", total: 40, paidOn: "2026-07-10" }),
      expense({ runId: "run1", runNumber: "PR-0001", total: 60.1, paidOn: "2026-07-10" }),
      expense({ payee: "Fatema", total: 25, paidOn: "2026-08-02" }),
    ]);
    assert.equal(r.total, 125.1);
    assert.equal(r.expenseCount, 3);
    assert.equal(r.transfers.length, 2);
    // Newest first.
    assert.deepEqual(
      r.transfers.map((t) => [t.paidOn, t.runNumber, t.expenses, t.amount]),
      [
        ["2026-08-02", null, 1, 25],
        ["2026-07-10", "PR-0001", 2, 100.1],
      ]
    );
    assert.deepEqual(r.byPayee, [
      { payee: "Aliasgar", transfers: 1, expenses: 2, amount: 100.1 },
      { payee: "Fatema", transfers: 1, expenses: 1, amount: 25 },
    ]);
    assert.deepEqual(
      r.byMonth.map((m) => [m.key, m.transfers, m.amount]),
      [
        ["2026-07", 1, 100.1],
        ["2026-08", 1, 25],
      ]
    );
  });

  test("a transfer is on a bank statement only once every expense in it is", () => {
    const r = paymentsMade([
      expense({ runId: "run1", bankConfirmedOn: "2026-07-12", total: 10 }),
      expense({ runId: "run1", bankConfirmedOn: null, total: 20 }),
      expense({ runId: "run2", bankConfirmedOn: "2026-07-11", total: 30 }),
      expense({ runId: "run2", bankConfirmedOn: "2026-07-13", total: 40 }),
    ]);
    const byKey = new Map(r.transfers.map((t) => [t.key, t]));
    assert.equal(byKey.get("run1")!.bankConfirmedOn, null);
    assert.equal(byKey.get("run2")!.bankConfirmedOn, "2026-07-13");
    assert.deepEqual(r.unconfirmed, { count: 1, amount: 20 });
  });

  test("the download's totals are the report's", () => {
    const r = paymentsMade([expense({ total: 12.5 }), expense({ total: 7.5 })]);
    const [transfers, byPayee] = paymentsMadeTables(r);
    assert.equal(transfers.totals!.amount, 20);
    assert.equal(byPayee.totals!.amount, 20);
    // Payee names, and nothing else about the account.
    assert.deepEqual(
      transfers.columns.map((c) => c.key),
      ["paidOn", "run", "payee", "reference", "expenses", "amount", "confirmed"]
    );
  });

  test("a Hijri period groups by Hijri month", () => {
    const r = paymentsMade([expense({ paidOn: "2026-07-10" })], "hijri");
    assert.match(r.byMonth[0].key, /^h\d{4}-\d{2}$/);
  });
});

describe("waiting", () => {
  test("bands by days waited, longest first", () => {
    const today = "2026-08-01";
    const w = waiting(
      [
        expense({ status: "approved", decidedOn: "2026-08-01", total: 1 }), // 0 days
        expense({ status: "approved", decidedOn: "2026-07-25", total: 2 }), // 7
        expense({ status: "approved", decidedOn: "2026-07-24", total: 4 }), // 8
        expense({ status: "approved", decidedOn: "2026-07-02", total: 8 }), // 30
        expense({ status: "approved", decidedOn: "2026-07-01", total: 16 }), // 31
        expense({ status: "approved", decidedOn: null, total: 999 }), // no date: left out
      ],
      (e) => e.decidedOn,
      today
    );
    assert.equal(w.count, 5);
    assert.equal(w.amount, 31);
    assert.equal(w.oldestDays, 31);
    assert.deepEqual(w.rows.map((r) => r.days), [31, 30, 8, 7, 0]);
    assert.deepEqual(
      w.bands.map((b) => [b.count, b.amount]),
      [
        [2, 3],
        [1, 4],
        [1, 8],
        [1, 16],
      ]
    );
  });

  test("nothing waiting has no oldest", () => {
    const w = waiting([], (e) => e.decidedOn, "2026-08-01");
    assert.equal(w.count, 0);
    assert.equal(w.oldestDays, null);
    assert.equal(w.bands.reduce((s, b) => s + b.count, 0), 0);
  });
});

describe("pipeline", () => {
  test("medians for each step, and declined counted apart from approved", () => {
    const p = pipeline(
      {
        submitted: [expense({ status: "submitted", submittedOn: "2026-07-20", decidedOn: null, paidOn: null })],
        approved: [expense({ status: "approved", decidedOn: "2026-07-28", paidOn: null, total: 50 })],
        decidedInPeriod: [
          expense({ status: "paid", submittedOn: "2026-07-01", decidedOn: "2026-07-02" }), // 1
          expense({ status: "approved", submittedOn: "2026-07-01", decidedOn: "2026-07-04", paidOn: null }), // 3
          expense({ status: "declined", submittedOn: "2026-07-01", decidedOn: "2026-07-11", paidOn: null, total: 30 }), // 10
        ],
        paidInPeriod: [
          expense({ submittedOn: "2026-07-01", decidedOn: "2026-07-02", paidOn: "2026-07-06" }), // 4, 5
          expense({ submittedOn: "2026-07-01", decidedOn: "2026-07-03", paidOn: "2026-07-09" }), // 6, 8
        ],
      },
      "2026-08-01"
    );
    assert.deepEqual(p.decided.approved, { count: 2, amount: 200 });
    assert.deepEqual(p.decided.declined, { count: 1, amount: 30 });
    assert.deepEqual(p.submitToDecision, { count: 3, median: 3, average: 4.7, slowest: 10 });
    assert.deepEqual(p.decisionToPayment, { count: 2, median: 5, average: 5, slowest: 6 });
    assert.deepEqual(p.submitToPayment, { count: 2, median: 6.5, average: 6.5, slowest: 8 });
    assert.equal(p.awaitingReview.oldestDays, 12);
    assert.equal(p.awaitingPayment.amount, 50);
    assert.deepEqual(
      p.byMonth.map((m) => ({ key: m.key, decided: m.decided, submitToDecision: m.submitToDecision, paid: m.paid, decisionToPayment: m.decisionToPayment })),
      [{ key: "2026-07", decided: 3, submitToDecision: 3, paid: 2, decisionToPayment: 5 }]
    );
  });

  test("a payment with no decision date doesn't count towards approved-to-paid", () => {
    const p = pipeline(
      { submitted: [], approved: [], decidedInPeriod: [], paidInPeriod: [expense({ decidedOn: null })] },
      "2026-08-01"
    );
    assert.equal(p.decisionToPayment.count, 0);
    assert.equal(p.submitToPayment.count, 1);
  });
});

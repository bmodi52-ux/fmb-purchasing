import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  lodgementFromRow,
  lodgementSnapshot,
  outstandingAdjustments,
  sinceLodged,
  type Lodgement,
} from "./gst-lodgement.ts";
import type { GstExpense, GstLine } from "./gst-summary.ts";

const expense = (id: string, total: number, gst: number): GstExpense => ({
  id,
  expenseNumber: id,
  vendorName: "V",
  total,
  gst,
  hasAttachment: true,
  vendorAbn: "1",
  vendorGstRegistered: true,
  lateForLockedPeriod: false,
});
const line = (expenseId: string, lineTotal: number, gst: number, isCapital = false): GstLine => ({
  expenseId,
  lineTotal,
  gst,
  isCapital,
  gstApportioned: false,
});

const q1Expenses = [expense("a", 110, 10), expense("b", 50, 0)];
const q1Lines = [line("a", 110, 10), line("b", 50, 0)];

const q1: Lodgement = lodgementFromRow({
  id: "lock-q1",
  label: "Q1 FY27",
  start_date: "2026-07-01",
  end_date: "2026-09-30",
  locked_at: "2026-10-28T00:00:00Z",
  ...lodgementSnapshot(q1Expenses, q1Lines, "receipt", []),
});

describe("lodgementSnapshot", () => {
  test("keeps the figures as they go on the return, and what they counted", () => {
    assert.equal(q1.basis, "receipt");
    assert.deepEqual([q1.g10, q1.g11, q1.oneB], [0, 160, 10]);
    assert.deepEqual(q1.expenseIds, ["a", "b"]);
  });

  test("a lock from before 0085 has no basis, and so nothing since lodged", () => {
    const old = lodgementFromRow({ id: "x", label: "Old", start_date: "2026-01-01", end_date: "2026-03-31", locked_at: "2026-04-01" });
    assert.equal(old.basis, null);
    assert.deepEqual(sinceLodged(old, q1Expenses), []);
  });
});

describe("outstandingAdjustments", () => {
  // Approved after Q1 was lodged, though dated inside it.
  const late = expense("late", 220, 20);
  const nowQ1 = { lodgement: q1, expenses: [...q1Expenses, late], lines: [...q1Lines, line("late", 220, 20)] };

  test("an expense dated in a lodged period that its figures missed is owed to a later return", () => {
    const owed = outstandingAdjustments([nowQ1], [q1]);
    assert.deepEqual(owed.expenses.map((e) => e.id), ["late"]);
    assert.deepEqual([owed.summary.g11, owed.summary.oneB], [220, 20]);
    assert.equal(owed.fromPeriod.get("late"), "Q1 FY27");
  });

  test("once a later lodgement takes it, it is owed no more", () => {
    const q2 = lodgementFromRow({
      id: "lock-q2",
      label: "Q2 FY27",
      start_date: "2026-10-01",
      end_date: "2026-12-31",
      locked_at: "2027-01-28",
      ...lodgementSnapshot([], [], "receipt", [late]),
    });
    assert.deepEqual(outstandingAdjustments([nowQ1], [q1, q2]).expenses, []);
  });

  test("overlapping lodged periods owe an expense once, with its lines once", () => {
    const fy = lodgementFromRow({
      id: "lock-fy",
      label: "FY27",
      start_date: "2026-07-01",
      end_date: "2027-06-30",
      locked_at: "2027-08-01",
      ...lodgementSnapshot(q1Expenses, q1Lines, "receipt", []),
    });
    const owed = outstandingAdjustments([nowQ1, { ...nowQ1, lodgement: fy }], [q1, fy]);
    assert.deepEqual(owed.expenses.map((e) => e.id), ["late"]);
    assert.equal(owed.summary.oneB, 20);
  });
});

/**
 * What the money words mean — once, for every report.
 *
 * "Spend", "committed", "paid" and the rest each name a set of expenses by
 * where they stand. Before this, each report picked its statuses for itself:
 * Budgets worked out "Committed" by subtraction, Money out named its statuses
 * inline, and the reporting code used "committed" for a set that included what
 * was already paid — the opposite of what Budgets means by it. Every report
 * now takes its statuses from here, so the same word is the same expenses on
 * every page, and the words add up:
 *
 *   spend     = awaiting review + outstanding + paid
 *   committed = awaiting review + outstanding      (spend not yet paid)
 *   accrued   =                   outstanding + paid (spend that is approved)
 *
 * Declined and withdrawn expenses are in none of them (expense-status.ts).
 *
 * Pure, and safe for the browser: the key under each report reads it.
 */

import type { ExpenseStatus } from "@/lib/expense-status";

export type Measure = "spend" | "committed" | "accrued" | "paid" | "outstanding" | "awaitingReview";

export type MeasureDefinition = {
  /** The word itself, as a column or tile is headed. */
  label: string;
  /** The same in plain words, where a choice is offered. */
  plain: string;
  statuses: readonly ExpenseStatus[];
  /** One sentence, for the key under a report and the manual. */
  meaning: string;
};

export const MEASURES: Record<Measure, MeasureDefinition> = {
  spend: {
    label: "Spend",
    plain: "Everything live",
    statuses: ["submitted", "approved", "paid"],
    meaning: "Every expense that still stands: waiting for an approver, approved, or paid.",
  },
  committed: {
    label: "Committed",
    plain: "Not yet paid",
    statuses: ["submitted", "approved"],
    meaning: "Spend that has not been paid yet: approved, or still waiting for an approver.",
  },
  accrued: {
    label: "Accrued",
    plain: "Approved and paid",
    statuses: ["approved", "paid"],
    meaning: "Spend that has been approved, whether or not it has been paid. Dated by its receipt, it is what the accounts and a GST return by receipt date count.",
  },
  paid: {
    label: "Paid",
    plain: "Paid",
    statuses: ["paid"],
    meaning: "Spend whose payment has been recorded.",
  },
  outstanding: {
    label: "Outstanding",
    plain: "Awaiting payment",
    statuses: ["approved"],
    meaning: "Approved and waiting to be paid.",
  },
  awaitingReview: {
    label: "Awaiting review",
    plain: "Awaiting review",
    statuses: ["submitted"],
    meaning: "Submitted and waiting for an approver. Counted as spend until it is declined.",
  },
};

export function statusesOf(measure: Measure): readonly ExpenseStatus[] {
  return MEASURES[measure].statuses;
}

/** Whether an expense in this status counts towards the measure. */
export function counts(measure: Measure, status: string): boolean {
  return (MEASURES[measure].statuses as readonly string[]).includes(status);
}

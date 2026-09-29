/**
 * Which expenses a figure counts, and by which date — said out loud.
 *
 * The reports audit found the same period giving different totals on Reports
 * and on Accounting with nothing on either page to say why: Reports counted
 * everything submitted, approved or paid, Accounting only what was approved
 * or paid. Both are right for their purpose. What was wrong was that neither
 * said which it was. Every report now takes both of these explicitly and
 * prints them, so two figures never differ without the page saying why.
 */

import type { ExpenseStatus } from "@/lib/expense-status";

/** Which expenses count. Declined and withdrawn never do (expense-status.ts). */
export type StatusBasis = "committed" | "approved" | "paid";

export const STATUS_BASES: { key: StatusBasis; statuses: readonly ExpenseStatus[]; label: string; short: string }[] = [
  {
    key: "committed",
    statuses: ["submitted", "approved", "paid"],
    label: "submitted, approved and paid",
    short: "Everything live",
  },
  { key: "approved", statuses: ["approved", "paid"], label: "approved and paid", short: "Approved and paid" },
  { key: "paid", statuses: ["paid"], label: "paid", short: "Paid" },
];

/** Which date puts an expense in a period. */
export type DateBasis = "receipt" | "paid";

export const DATE_BASIS_LABEL: Record<DateBasis, string> = {
  // expenses.report_date (0083): the receipt's date, or the day it was
  // submitted in Sydney when the receipt had none.
  receipt: "By receipt date",
  paid: "By payment date",
};

export function parseStatusBasis(value: unknown, fallback: StatusBasis = "committed"): StatusBasis {
  return STATUS_BASES.some((b) => b.key === value) ? (value as StatusBasis) : fallback;
}

export function statusesFor(basis: StatusBasis): readonly ExpenseStatus[] {
  return STATUS_BASES.find((b) => b.key === basis)!.statuses;
}

/** "By receipt date · approved and paid" — the line every report prints under its title. */
export function describeBasis(status: StatusBasis, date: DateBasis = "receipt"): string {
  return `${DATE_BASIS_LABEL[date]} · ${STATUS_BASES.find((b) => b.key === status)!.label}`;
}

/**
 * The part of a ledger a status basis counts: its expenses, and the lines and
 * unit costs that belong to them.
 */
export function withStatusBasis<
  L extends {
    expenses: { id: string; status: string }[];
    lines: { expenseId: string }[];
    unitCosts: { expense_id: string }[];
  },
>(ledger: L, basis: StatusBasis): L {
  if (basis === "committed") return ledger;
  const wanted = new Set<string>(statusesFor(basis));
  const expenses = ledger.expenses.filter((e) => wanted.has(e.status));
  const ids = new Set(expenses.map((e) => e.id));
  return {
    ...ledger,
    expenses,
    lines: ledger.lines.filter((l) => ids.has(l.expenseId)),
    unitCosts: ledger.unitCosts.filter((c) => ids.has(c.expense_id)),
  };
}

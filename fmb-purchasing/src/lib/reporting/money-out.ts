/**
 * Money out: what has been paid, what is waiting to be, and how long each
 * step takes (reports overhaul, P3). Pure.
 *
 * Reports answer what was spent. Nothing answered what has actually left the
 * account, to whom, whether the bank has confirmed it, or how long members
 * wait to be reimbursed. These do — and name the payee, but never a bank
 * account: they are read by everyone who can see Reports, and account numbers
 * stay on the Payments page, with the people who pay.
 */

import { dayCount } from "@/lib/periods";
import { monthBucket, type MonthCalendar } from "./aggregate.ts";
import type { ReportTable } from "./tables.ts";

/** One expense as money out sees it. Days are calendar days in Sydney. */
export type MoneyExpense = {
  id: string;
  entry: string | null;
  status: string;
  vendor: string;
  payee: string;
  total: number;
  submittedOn: string;
  decidedOn: string | null;
  paidOn: string | null;
  runId: string | null;
  runNumber: string | null;
  reference: string | null;
  bankConfirmedOn: string | null;
};

const cents = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => cents(xs.reduce((s, x) => s + x, 0));

/** Whole days from one calendar day to a later one: the same day is 0. */
export function daysBetween(from: string, to: string): number {
  return dayCount(from, to) - 1;
}

/* ------------------------------------------------------------------ */
/* Payments made                                                       */
/* ------------------------------------------------------------------ */

/** One bank transfer: a payment run, or a single expense paid on its own. */
export type Transfer = {
  key: string;
  runNumber: string | null;
  paidOn: string;
  payee: string;
  reference: string | null;
  expenses: number;
  amount: number;
  /** The statement date it was matched to, once every expense in it has been. */
  bankConfirmedOn: string | null;
};

export type PaymentsMade = {
  total: number;
  expenseCount: number;
  transfers: Transfer[];
  /** Paid, and not yet matched to a bank statement. */
  unconfirmed: { count: number; amount: number };
  byPayee: { payee: string; transfers: number; expenses: number; amount: number }[];
  byMonth: { key: string; label: string; amount: number; transfers: number }[];
};

export function paymentsMade(paid: MoneyExpense[], calendar: MonthCalendar = "gregorian"): PaymentsMade {
  const groups = new Map<string, MoneyExpense[]>();
  for (const e of paid) {
    if (!e.paidOn) continue;
    const key = e.runId ?? `expense:${e.id}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  const transfers: Transfer[] = [...groups.entries()]
    .map(([key, es]) => ({
      key,
      runNumber: es[0].runNumber,
      paidOn: es[0].paidOn!,
      payee: es[0].payee,
      reference: es[0].reference,
      expenses: es.length,
      amount: sum(es.map((e) => e.total)),
      bankConfirmedOn: es.every((e) => e.bankConfirmedOn)
        ? es.map((e) => e.bankConfirmedOn!).sort().at(-1)!
        : null,
    }))
    .sort((a, b) => b.paidOn.localeCompare(a.paidOn) || (b.runNumber ?? "").localeCompare(a.runNumber ?? ""));

  const byPayee = new Map<string, { payee: string; transfers: number; expenses: number; amount: number }>();
  for (const t of transfers) {
    const p = byPayee.get(t.payee) ?? { payee: t.payee, transfers: 0, expenses: 0, amount: 0 };
    p.transfers += 1;
    p.expenses += t.expenses;
    p.amount = cents(p.amount + t.amount);
    byPayee.set(t.payee, p);
  }

  const byMonth = new Map<string, { key: string; label: string; amount: number; transfers: number }>();
  for (const t of transfers) {
    const m = monthBucket(t.paidOn, calendar);
    const row = byMonth.get(m.key) ?? { key: m.key, label: m.label, amount: 0, transfers: 0 };
    row.amount = cents(row.amount + t.amount);
    row.transfers += 1;
    byMonth.set(m.key, row);
  }

  const unconfirmed = paid.filter((e) => !e.bankConfirmedOn);
  return {
    total: sum(paid.map((e) => e.total)),
    expenseCount: paid.length,
    transfers,
    unconfirmed: { count: unconfirmed.length, amount: sum(unconfirmed.map((e) => e.total)) },
    byPayee: [...byPayee.values()].sort((a, b) => b.amount - a.amount || a.payee.localeCompare(b.payee)),
    byMonth: [...byMonth.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

/* ------------------------------------------------------------------ */
/* Waiting — for payment, or for review                                */
/* ------------------------------------------------------------------ */

export const AGE_BANDS = [
  { label: "A week or less", upTo: 7 },
  { label: "8 to 14 days", upTo: 14 },
  { label: "15 to 30 days", upTo: 30 },
  { label: "More than 30 days", upTo: Number.POSITIVE_INFINITY },
] as const;

export type WaitingRow = MoneyExpense & { since: string; days: number };

export type Waiting = {
  count: number;
  amount: number;
  oldestDays: number | null;
  bands: { label: string; count: number; amount: number }[];
  /** Longest waiting first. */
  rows: WaitingRow[];
  byPayee: { payee: string; count: number; amount: number }[];
};

/**
 * What is waiting, and for how long, as of today: approved expenses since
 * their approval, or submitted ones since they were submitted.
 */
export function waiting(expenses: MoneyExpense[], since: (e: MoneyExpense) => string | null, today: string): Waiting {
  const rows: WaitingRow[] = expenses
    .flatMap((e) => {
      const from = since(e);
      return from ? [{ ...e, since: from, days: Math.max(0, daysBetween(from, today)) }] : [];
    })
    .sort((a, b) => b.days - a.days || (a.entry ?? "").localeCompare(b.entry ?? ""));

  const byPayee = new Map<string, { payee: string; count: number; amount: number }>();
  for (const r of rows) {
    const p = byPayee.get(r.payee) ?? { payee: r.payee, count: 0, amount: 0 };
    p.count += 1;
    p.amount = cents(p.amount + r.total);
    byPayee.set(r.payee, p);
  }

  return {
    count: rows.length,
    amount: sum(rows.map((r) => r.total)),
    oldestDays: rows[0]?.days ?? null,
    bands: AGE_BANDS.map((band, i) => {
      const lower = i === 0 ? -1 : AGE_BANDS[i - 1].upTo;
      const inBand = rows.filter((r) => r.days > lower && r.days <= band.upTo);
      return { label: band.label, count: inBand.length, amount: sum(inBand.map((r) => r.total)) };
    }),
    rows,
    byPayee: [...byPayee.values()].sort((a, b) => b.amount - a.amount || a.payee.localeCompare(b.payee)),
  };
}

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

export type Timing = { count: number; median: number | null; average: number | null; slowest: number | null };

function timing(days: number[]): Timing {
  if (days.length === 0) return { count: 0, median: null, average: null, slowest: null };
  const sorted = [...days].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    average: Math.round((sorted.reduce((s, d) => s + d, 0) / sorted.length) * 10) / 10,
    slowest: sorted.at(-1)!,
  };
}

export type Pipeline = {
  /** Now: submitted and not yet decided, since submission. */
  awaitingReview: Waiting;
  /** Now: approved and not yet paid, since approval. */
  awaitingPayment: Waiting;
  /** In the period, by decision date. */
  decided: { approved: { count: number; amount: number }; declined: { count: number; amount: number } };
  /** How long each step took, for decisions and payments made in the period. */
  submitToDecision: Timing;
  decisionToPayment: Timing;
  submitToPayment: Timing;
  byMonth: { key: string; label: string; decided: number; submitToDecision: number | null; paid: number; decisionToPayment: number | null }[];
};

export function pipeline(
  input: {
    submitted: MoneyExpense[];
    approved: MoneyExpense[];
    /** Approved, paid or declined, with the decision dated in the period. */
    decidedInPeriod: MoneyExpense[];
    /** Paid, with the payment dated in the period. */
    paidInPeriod: MoneyExpense[];
  },
  today: string,
  calendar: MonthCalendar = "gregorian"
): Pipeline {
  const declined = input.decidedInPeriod.filter((e) => e.status === "declined");
  const approved = input.decidedInPeriod.filter((e) => e.status !== "declined");

  const toDecision = (e: MoneyExpense) => daysBetween(e.submittedOn, e.decidedOn!);
  const toPayment = (e: MoneyExpense) => (e.decidedOn ? daysBetween(e.decidedOn, e.paidOn!) : null);

  const months = new Map<string, { key: string; label: string; decisions: number[]; payments: number[] }>();
  const bucket = (day: string) => {
    const m = monthBucket(day, calendar);
    const row = months.get(m.key) ?? { key: m.key, label: m.label, decisions: [], payments: [] };
    months.set(m.key, row);
    return row;
  };
  for (const e of input.decidedInPeriod) bucket(e.decidedOn!).decisions.push(toDecision(e));
  for (const e of input.paidInPeriod) {
    const d = toPayment(e);
    if (d !== null) bucket(e.paidOn!).payments.push(d);
  }

  return {
    awaitingReview: waiting(input.submitted, (e) => e.submittedOn, today),
    awaitingPayment: waiting(input.approved, (e) => e.decidedOn, today),
    decided: {
      approved: { count: approved.length, amount: sum(approved.map((e) => e.total)) },
      declined: { count: declined.length, amount: sum(declined.map((e) => e.total)) },
    },
    submitToDecision: timing(input.decidedInPeriod.map(toDecision)),
    decisionToPayment: timing(input.paidInPeriod.map(toPayment).filter((d): d is number => d !== null)),
    submitToPayment: timing(input.paidInPeriod.map((e) => daysBetween(e.submittedOn, e.paidOn!))),
    byMonth: [...months.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((m) => ({
        key: m.key,
        label: m.label,
        decided: m.decisions.length,
        submitToDecision: timing(m.decisions).median,
        paid: m.payments.length,
        decisionToPayment: timing(m.payments).median,
      })),
  };
}

/* ------------------------------------------------------------------ */
/* Downloads                                                           */
/* ------------------------------------------------------------------ */

export function paymentsMadeTables(r: PaymentsMade): ReportTable[] {
  return [
    {
      title: "Transfers",
      columns: [
        { key: "paidOn", label: "Paid", kind: "date" },
        { key: "run", label: "Run", kind: "text" },
        { key: "payee", label: "Payee", kind: "text" },
        { key: "reference", label: "Reference", kind: "text" },
        { key: "expenses", label: "Expenses", kind: "count" },
        { key: "amount", label: "Amount", kind: "money" },
        { key: "confirmed", label: "On a bank statement", kind: "date" },
      ],
      rows: r.transfers.map((t) => ({
        paidOn: t.paidOn,
        run: t.runNumber ?? "",
        payee: t.payee,
        reference: t.reference ?? "",
        expenses: t.expenses,
        amount: t.amount,
        confirmed: t.bankConfirmedOn,
      })),
      totals: { run: "Total", expenses: r.expenseCount, amount: r.total },
    },
    {
      title: "By payee",
      columns: [
        { key: "payee", label: "Payee", kind: "text" },
        { key: "transfers", label: "Transfers", kind: "count" },
        { key: "expenses", label: "Expenses", kind: "count" },
        { key: "amount", label: "Amount", kind: "money" },
      ],
      rows: r.byPayee,
      totals: { payee: "Total", transfers: r.transfers.length, expenses: r.expenseCount, amount: r.total },
    },
  ];
}

export function waitingTables(title: string, sinceLabel: string, w: Waiting): ReportTable[] {
  return [
    {
      title,
      columns: [
        { key: "entry", label: "Entry", kind: "text" },
        { key: "vendor", label: "Vendor", kind: "text" },
        { key: "payee", label: "Payee", kind: "text" },
        { key: "since", label: sinceLabel, kind: "date" },
        { key: "days", label: "Days waiting", kind: "count" },
        { key: "total", label: "Amount", kind: "money" },
      ],
      rows: w.rows.map((r) => ({ entry: r.entry ?? "", vendor: r.vendor, payee: r.payee, since: r.since, days: r.days, total: r.total })),
      totals: { entry: "Total", total: w.amount },
    },
    {
      title: "How long",
      columns: [
        { key: "label", label: "Waiting", kind: "text" },
        { key: "count", label: "Expenses", kind: "count" },
        { key: "amount", label: "Amount", kind: "money" },
      ],
      rows: w.bands,
      totals: { label: "Total", count: w.count, amount: w.amount },
    },
  ];
}

export function pipelineTables(p: Pipeline): ReportTable[] {
  const t = (label: string, x: Timing) => ({ step: label, count: x.count, median: x.median, average: x.average, slowest: x.slowest });
  return [
    {
      title: "How long each step takes",
      columns: [
        { key: "step", label: "Step", kind: "text" },
        { key: "count", label: "Expenses", kind: "count" },
        { key: "median", label: "Median days", kind: "number" },
        { key: "average", label: "Average days", kind: "number" },
        { key: "slowest", label: "Slowest", kind: "count" },
      ],
      rows: [
        t("Submitted to decided", p.submitToDecision),
        t("Approved to paid", p.decisionToPayment),
        t("Submitted to paid", p.submitToPayment),
      ],
    },
    {
      title: "By month",
      columns: [
        { key: "label", label: "Month", kind: "text" },
        { key: "decided", label: "Decided", kind: "count" },
        { key: "submitToDecision", label: "Median days to decide", kind: "number" },
        { key: "paid", label: "Paid", kind: "count" },
        { key: "decisionToPayment", label: "Median days to pay", kind: "number" },
      ],
      rows: p.byMonth,
    },
    ...waitingTables("Awaiting review", "Submitted", p.awaitingReview),
  ];
}

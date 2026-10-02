/**
 * Exceptions: the spend in a period that something is wrong with, or may be
 * (reports overhaul, P3). Pure.
 *
 * Needs attention is a work list — everything waiting on someone, whenever it
 * came in. This is the same kind of question asked of a period, with the
 * money attached: of what was spent in it, how much sits on a receipt that
 * doesn't add up, on lines nobody classified, on packs whose unit cost can't
 * be believed. It is what a committee or an auditor asks before trusting the
 * other reports' figures, and it downloads so it can be answered on paper.
 *
 * Each check is the one the app already applies elsewhere — the approver's
 * receipt flags, the stored-GST band, the duplicate rule — so this report
 * never raises something the expense's own page says is fine.
 */

import { categoryLabelsById } from "@/lib/categories";
import { claimVsReceipt, round2, storedGstDisagreement, totalChangedFromScan } from "@/lib/expense-money";
import type { DuplicateMatch } from "@/lib/duplicates";
import type { DateRange } from "./ledger-rows.ts";
import type { ReportTable } from "./tables.ts";

export type ExceptionExpense = {
  id: string;
  entry: string | null;
  vendor: string;
  /** The vendor as a filter keys it (filters.ts vendorKey). */
  vendorKey: string;
  status: string;
  /** The day it counts on in reports (0083). */
  reportDate: string;
  total: number;
  /** The sum of its lines' GST. */
  gst: number;
  gstPrinted: number | null;
  receiptTotal: number | null;
  receiptTotalScanned: number | null;
  receiptTotalNote: string | null;
};

export type ExceptionLine = {
  id: string;
  expenseId: string;
  kind: string;
  description: string;
  lineTotal: number;
  gst: number;
  gstApplicable: boolean;
  notOnReceipt: boolean;
  notOnReceiptNote: string | null;
  categoryId: string | null;
};

export type DisputedPack = {
  expenseId: string;
  /** The line it was bought on, so a category filter can place it. */
  lineId: string;
  itemName: string;
  lineTotal: number;
  costPerBaseUnit: number;
  baseUnit: string;
};

/**
 * A receipt date that can't be right (0084). Carries its own expense, since
 * a wrong date can put the expense outside the period it was submitted in.
 */
export type DateConcern = {
  expenseId: string;
  entry: string | null;
  vendor: string;
  status: string;
  total: number;
  receiptDate: string;
  submittedOn: string;
  concern: "after_submission" | "year_before_submission";
};

export type ExceptionsInput = {
  range: DateRange;
  expenses: ExceptionExpense[];
  lines: ExceptionLine[];
  categories: { id: string; name: string; parent_category_id: string | null }[];
  disputedPacks: DisputedPack[];
  dateConcerns: DateConcern[];
  duplicates: Map<string, DuplicateMatch[]>;
  /**
   * Narrow to these categories; none means all. A receipt is in a category
   * when one of its lines is: checks on a line then list only the lines in
   * it, and checks on a whole receipt — its total, its GST, its date — list
   * the receipts that have such a line, judged on all their lines as ever.
   */
  categoryIds?: string[];
};

export type ExceptionKind =
  | "receipt_gap"
  | "off_receipt"
  | "total_changed"
  | "gst_printed"
  | "not_itemised"
  | "uncategorised"
  | "parent_category"
  | "disputed_pack"
  | "receipt_date"
  | "duplicate";

export type ExceptionRow = {
  expenseId: string;
  entry: string | null;
  vendor: string;
  date: string;
  status: string;
  /** What is wrong, in a line. */
  detail: string;
  /** The money it concerns: a difference, or the amount of the line or expense. */
  amount: number;
};

export type ExceptionGroup = {
  kind: ExceptionKind;
  heading: string;
  why: string;
  /** What `amount` means for this check. */
  amountLabel: string;
  signed?: boolean;
  rows: ExceptionRow[];
  /** Expenses with at least one row. */
  expenses: number;
  /** Rows' amounts, as sizes: a difference either way adds to what is out. */
  amount: number;
};

export type Exceptions = {
  expenseCount: number;
  spend: number;
  /** Expenses in the period with anything below. */
  flaggedExpenses: number;
  flaggedSpend: number;
  /** Every check, in reading order, including those with nothing to show. */
  groups: ExceptionGroup[];
};

export const EXCEPTION_CHECKS: {
  kind: ExceptionKind;
  heading: string;
  why: string;
  amountLabel: string;
  /** Whether the amount is a difference, which can go either way. */
  signed?: boolean;
}[] = [
  {
    kind: "receipt_gap",
    heading: "Receipts that don't add up",
    why: "The lines on the receipt come to more or less than its printed total, and nobody said why.",
    amountLabel: "Difference",
    signed: true,
  },
  {
    kind: "off_receipt",
    heading: "Claimed beyond the receipt",
    why: "Lines marked as not on the attached receipt — a charge added by hand, say — with the reason given.",
    amountLabel: "Amount",
  },
  {
    kind: "total_changed",
    heading: "Receipt totals changed from the scan",
    why: "The total was typed over what the scan read. Usually a misread; worth a look when the lines then add up exactly.",
    amountLabel: "Change",
    signed: true,
  },
  {
    kind: "gst_printed",
    heading: "GST that differs from the receipt's",
    why: "The GST on the lines differs from the GST the receipt prints by more than rounding explains: a taxable line missed, or one flagged that shouldn't be.",
    amountLabel: "Printed less lines",
    signed: true,
  },
  {
    kind: "not_itemised",
    heading: "Spend not itemised",
    why: "Part of a receipt recorded with nothing said about what it was for.",
    amountLabel: "Amount",
  },
  {
    kind: "uncategorised",
    heading: "Lines with no category",
    why: "Goods nobody has classified. They sit outside every report cut by category.",
    amountLabel: "Amount",
  },
  {
    kind: "parent_category",
    heading: "Lines on a parent category",
    why: "Filed under a heading rather than one of its categories, so no single budget line carries them.",
    amountLabel: "Amount",
  },
  {
    kind: "disputed_pack",
    heading: "Pack sizes that disagree with the receipt",
    why: "What the pack is said to hold and what the receipt implies differ five-fold or more, so the unit cost is left out of price reports.",
    amountLabel: "Line total",
  },
  {
    kind: "receipt_date",
    heading: "Receipt dates to check",
    why: "Dated after they were submitted, or more than a year before. Includes expenses submitted in the period whose date puts them outside it.",
    amountLabel: "Expense total",
  },
  {
    kind: "duplicate",
    heading: "Possible duplicates",
    why: "The same receipt file, or the same vendor and invoice number, as another expense that counts as spend.",
    amountLabel: "Expense total",
  },
];

/** A status as a page says it. */
const STATUS_WORD: Record<string, string> = { submitted: "Awaiting review", approved: "Approved", paid: "Paid" };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));
const inRange = (day: string, r: DateRange) => day >= r.start && day <= r.end;

export function findExceptions(input: ExceptionsInput): Exceptions {
  const rows = new Map<ExceptionKind, ExceptionRow[]>(EXCEPTION_CHECKS.map((c) => [c.kind, []]));
  const linesOf = new Map<string, ExceptionLine[]>();
  for (const l of input.lines) linesOf.set(l.expenseId, [...(linesOf.get(l.expenseId) ?? []), l]);

  const wanted = new Set(input.categoryIds ?? []);
  const narrowed = wanted.size > 0;
  const inCategory = (l: ExceptionLine) => !narrowed || (l.categoryId !== null && wanted.has(l.categoryId));
  const expenses = narrowed ? input.expenses.filter((e) => (linesOf.get(e.id) ?? []).some(inCategory)) : input.expenses;
  const byId = new Map(expenses.map((e) => [e.id, e]));
  const lineById = new Map(input.lines.map((l) => [l.id, l]));

  const push = (kind: ExceptionKind, e: ExceptionExpense, detail: string, amount: number) =>
    rows.get(kind)!.push({
      expenseId: e.id,
      entry: e.entry,
      vendor: e.vendor,
      date: e.reportDate,
      status: e.status,
      detail,
      amount: round2(amount),
    });

  const hasChildren = new Set(input.categories.map((c) => c.parent_category_id).filter(Boolean));
  const categoryLabel = categoryLabelsById(input.categories);

  for (const e of expenses) {
    const lines = linesOf.get(e.id) ?? [];

    if (e.receiptTotal != null) {
      const { unexplained } = claimVsReceipt(
        lines.map((l) => ({ kind: "goods", lineTotal: l.lineTotal, gstApplicable: false, notOnReceipt: l.notOnReceipt })),
        e.receiptTotal
      );
      if (unexplained !== 0) {
        push(
          "receipt_gap",
          e,
          `The receipt says ${money(e.receiptTotal)}; the lines on it come to ${money(round2(e.receiptTotal - unexplained))}`,
          unexplained
        );
      }
      if (totalChangedFromScan(e.receiptTotal, e.receiptTotalScanned)) {
        push(
          "total_changed",
          e,
          `Read as ${money(e.receiptTotalScanned!)}, changed to ${money(e.receiptTotal)}${e.receiptTotalNote ? ` — ${e.receiptTotalNote}` : ""}`,
          e.receiptTotal - e.receiptTotalScanned!
        );
      }
    }

    const gstOff = storedGstDisagreement(e.gst, e.gstPrinted, lines.filter((l) => l.gstApplicable).length);
    if (gstOff !== null) {
      push("gst_printed", e, `The receipt prints ${money(e.gstPrinted!)}; the lines carry ${money(e.gst)}`, gstOff);
    }

    for (const l of lines.filter(inCategory)) {
      if (l.notOnReceipt) {
        push("off_receipt", e, l.notOnReceiptNote ? `${l.description} — ${l.notOnReceiptNote}` : l.description, l.lineTotal);
      }
      if (l.kind === "unallocated") push("not_itemised", e, l.description, l.lineTotal);
      if (l.kind === "goods" && !l.categoryId) push("uncategorised", e, l.description, l.lineTotal);
      if (l.categoryId && hasChildren.has(l.categoryId)) {
        push("parent_category", e, `${l.description} — under ${categoryLabel.get(l.categoryId) ?? "a heading"}`, l.lineTotal);
      }
    }

    const dupes = input.duplicates.get(e.id);
    if (dupes?.length) {
      const why = (m: DuplicateMatch) =>
        `${m.expenseNumber ?? "another expense"} (${m.reason === "same-file" ? "same file" : "same invoice"})`;
      push("duplicate", e, `Looks like ${dupes.map(why).join(", ")}`, e.total);
    }
  }

  for (const p of input.disputedPacks) {
    const e = byId.get(p.expenseId);
    const line = lineById.get(p.lineId);
    if (!e || (narrowed && !(line && inCategory(line)))) continue;
    push("disputed_pack", e, `${p.itemName}: works out at ${money(p.costPerBaseUnit)} per ${p.baseUnit}`, p.lineTotal);
  }

  for (const c of input.dateConcerns) {
    const e = byId.get(c.expenseId);
    // In the period by its date, or submitted in it and dated out of it —
    // though one dated out of it has no lines here to place it in a category.
    if (!e && (narrowed || !inRange(c.submittedOn, input.range))) continue;
    rows.get("receipt_date")!.push({
      expenseId: c.expenseId,
      entry: c.entry,
      vendor: c.vendor,
      date: c.receiptDate,
      status: c.status,
      detail: `Dated ${c.receiptDate}, ${c.concern === "after_submission" ? "after" : "more than a year before"} it was submitted on ${c.submittedOn}`,
      amount: c.total,
    });
  }

  const groups: ExceptionGroup[] = EXCEPTION_CHECKS.map((check) => {
    const list = rows.get(check.kind)!.sort((a, b) => a.date.localeCompare(b.date) || (a.entry ?? "").localeCompare(b.entry ?? ""));
    return {
      ...check,
      rows: list,
      expenses: new Set(list.map((r) => r.expenseId)).size,
      amount: sum(list.map((r) => Math.abs(r.amount))),
    };
  });

  // Headline counts the period's own expenses; a date concern from outside
  // it is listed, but its money isn't this period's.
  const flagged = new Set(groups.flatMap((g) => g.rows.map((r) => r.expenseId)).filter((id) => byId.has(id)));
  return {
    expenseCount: expenses.length,
    spend: sum(expenses.map((e) => e.total)),
    flaggedExpenses: flagged.size,
    flaggedSpend: sum([...flagged].map((id) => byId.get(id)!.total)),
    groups,
  };
}

/* ------------------------------------------------------------------ */
/* Downloads                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every exception in one table first — a CSV carries only the first table —
 * then the summary, then a sheet per check for the Excel file.
 */
export function exceptionTables(x: Exceptions): ReportTable[] {
  const found = x.groups.filter((g) => g.rows.length > 0);
  return [
    {
      title: "All exceptions",
      columns: [
        { key: "check", label: "Check", kind: "text" },
        { key: "entry", label: "Entry", kind: "text" },
        { key: "date", label: "Date", kind: "date" },
        { key: "vendor", label: "Vendor", kind: "text" },
        { key: "status", label: "Status", kind: "text" },
        { key: "detail", label: "What", kind: "text" },
        { key: "amount", label: "Amount", kind: "money" },
      ],
      rows: found.flatMap((g) =>
        g.rows.map((r) => ({ check: g.heading, entry: r.entry ?? "", date: r.date, vendor: r.vendor, status: r.status, detail: r.detail, amount: r.amount }))
      ),
    },
    {
      title: "Summary",
      columns: [
        { key: "heading", label: "Check", kind: "text" },
        { key: "expenses", label: "Expenses", kind: "count" },
        { key: "rows", label: "Items", kind: "count" },
        { key: "amount", label: "Amount", kind: "money" },
      ],
      rows: x.groups.map((g) => ({ heading: g.heading, expenses: g.expenses, rows: g.rows.length, amount: g.amount })),
    },
    ...found.map(exceptionGroupTable),
  ];
}

/**
 * One check's findings as a table. On a page the entry opens the expense; a
 * check whose amount is a difference shows which way it goes.
 */
export function exceptionGroupTable(g: ExceptionGroup): ReportTable {
  return {
    title: g.heading,
    columns: [
      { key: "entry", label: "Entry", kind: "text", link: "href" },
      { key: "date", label: "Date", kind: "date" },
      { key: "vendor", label: "Vendor", kind: "text" },
      { key: "status", label: "Status", kind: "text", badge: "stage" },
      { key: "detail", label: "What", kind: "text" },
      { key: "amount", label: g.amountLabel, kind: "money", signed: g.signed },
    ],
    rows: g.rows.map((r) => ({
      entry: r.entry ?? "",
      date: r.date,
      vendor: r.vendor,
      status: STATUS_WORD[r.status] ?? r.status,
      stage: r.status,
      detail: r.detail,
      amount: r.amount,
      href: `/expenses/${r.expenseId}`,
    })),
  };
}

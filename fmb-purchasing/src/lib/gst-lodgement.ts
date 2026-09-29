/**
 * Lodged GST periods: what was lodged, and what is owed to a later return
 * (reports audit 2a-10, migration 0085). Pure.
 *
 * A lock keeps the figures it was lodged with and the expenses they counted.
 * An expense dated in the period that they did not count — approved after the
 * return went in, say — is an adjustment: it belongs in the next return, not
 * in a re-reading of the old one. When that next period is locked it records
 * the adjustments it took, so each is taken exactly once.
 */

import { summariseGst, type GstExpense, type GstLine, type GstSummary } from "@/lib/gst-summary";

export type LodgedBasis = "receipt" | "paid";

export type Lodgement = {
  id: string;
  label: string;
  start: string;
  end: string;
  lockedAt: string;
  /** Null for a lock made before 0085, which kept no figures. */
  basis: LodgedBasis | null;
  g10: number | null;
  g11: number | null;
  oneB: number | null;
  expenseIds: string[];
  adjustmentIds: string[];
};

type LockRow = {
  id: string;
  label: string;
  start_date: string;
  end_date: string;
  locked_at: string;
  lodged_basis?: string | null;
  lodged_g10?: number | string | null;
  lodged_g11?: number | string | null;
  lodged_1b?: number | string | null;
  lodged_expense_ids?: string[] | null;
  adjustment_expense_ids?: string[] | null;
};

export const LOCK_COLUMNS =
  "id, label, start_date, end_date, note, locked_by, locked_at, unlocked_at, lodged_basis, lodged_g10, lodged_g11, lodged_1b, lodged_expense_ids, adjustment_expense_ids";

const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));

export function lodgementFromRow(row: LockRow): Lodgement {
  return {
    id: row.id,
    label: row.label,
    start: row.start_date,
    end: row.end_date,
    lockedAt: row.locked_at,
    basis: row.lodged_basis === "receipt" || row.lodged_basis === "paid" ? row.lodged_basis : null,
    g10: num(row.lodged_g10),
    g11: num(row.lodged_g11),
    oneB: num(row.lodged_1b),
    expenseIds: row.lodged_expense_ids ?? [],
    adjustmentIds: row.adjustment_expense_ids ?? [],
  };
}

/** What a lock records: the figures as they go on the return, and what they counted. */
export function lodgementSnapshot(
  expenses: GstExpense[],
  lines: GstLine[],
  basis: LodgedBasis,
  adjustments: GstExpense[]
): {
  lodged_basis: LodgedBasis;
  lodged_g10: number;
  lodged_g11: number;
  lodged_1b: number;
  lodged_expense_ids: string[];
  adjustment_expense_ids: string[];
} {
  const summary = summariseGst(expenses, lines);
  return {
    lodged_basis: basis,
    lodged_g10: summary.g10,
    lodged_g11: summary.g11,
    lodged_1b: summary.oneB,
    lodged_expense_ids: expenses.map((e) => e.id),
    adjustment_expense_ids: adjustments.map((e) => e.id),
  };
}

/** The expenses now in a lodged period that its lodged figures did not count. */
export function sinceLodged(lodgement: Lodgement, expenses: GstExpense[]): GstExpense[] {
  if (!lodgement.basis) return [];
  const counted = new Set(lodgement.expenseIds);
  return expenses.filter((e) => !counted.has(e.id));
}

export type OutstandingAdjustments = {
  expenses: GstExpense[];
  summary: GstSummary;
  /** Which lodged period each came from, for saying so. */
  fromPeriod: Map<string, string>;
};

/**
 * What earlier lodged periods owe to the return being prepared: every expense
 * dated in one of them that its lodged figures did not count and that no
 * lodgement has yet taken as an adjustment.
 *
 * `lodged` pairs each lodgement with the expenses and lines dated in its
 * period as they stand now, read on the basis it was lodged on.
 */
export function outstandingAdjustments(
  lodged: { lodgement: Lodgement; expenses: GstExpense[]; lines: GstLine[] }[],
  allLodgements: Lodgement[]
): OutstandingAdjustments {
  const taken = new Set(allLodgements.flatMap((l) => l.adjustmentIds));
  const expenses: GstExpense[] = [];
  const lines: GstLine[] = [];
  const fromPeriod = new Map<string, string>();

  for (const { lodgement, expenses: now, lines: nowLines } of lodged) {
    // Lodged periods can overlap (a quarter, and later its year): an expense
    // is owed once, from the first lodgement that missed it.
    const owed = sinceLodged(lodgement, now).filter((e) => !taken.has(e.id) && !fromPeriod.has(e.id));
    const owedIds = new Set(owed.map((e) => e.id));
    for (const e of owed) {
      expenses.push(e);
      fromPeriod.set(e.id, lodgement.label);
    }
    lines.push(...nowLines.filter((l) => owedIds.has(l.expenseId)));
  }

  return { expenses, summary: summariseGst(expenses, lines), fromPeriod };
}

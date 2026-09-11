/**
 * How budgets set in different calendars share out across the days they
 * cover (scratchpad #22, decided 2026-09-11).
 *
 * Every budget is money spread over its days. Budgets for one category can be
 * set for a Hijri year, a financial year, a calendar year, a quarter, a month
 * or any range, and they may overlap. The rule:
 *
 *   Every budget adds up to exactly what was entered. Where two overlap, the
 *   one that was there first keeps the days it covers; the newer one's
 *   remainder goes on the days no other budget covered.
 *
 * So a $9,000 Hijri year that puts $7,449 inside a financial year leaves a
 * $10,000 financial year budget $2,551 for its 72 uncovered days, and both
 * totals hold.
 *
 * "There first" is a priority on each budget: a new one gets the lowest, so
 * everything already set keeps its days. When the totals cannot both hold — a
 * new budget whose days are all covered, one smaller than what is already on
 * its days, an edit that pushes a later budget below zero — saving is refused
 * with a warning naming what would change, and the person can override. An
 * override gives the budget being saved every day it covers, and each budget
 * it displaces has its total moved by the difference: its remaining days keep
 * the daily amount they had, and the displaced days carry the new budget's.
 *
 * Spread evenly by day. Monthly phasing (#39) will weight the days instead.
 * Pure: plain records in, plain figures out, tested on its own.
 */

export type BudgetRecord = {
  id: string;
  start: string;
  end: string;
  amount: number;
  /** Higher keeps contested days. */
  priority: number;
  label: string;
  /**
   * Monthly phasing (#39): the share of the budget each month of its own year
   * carries, as percentages. Without it the budget is spread evenly by day.
   */
  months?: { start: string; end: string; percent: number }[];
};

/**
 * How much of a budget's remainder one of its days should carry, relative to
 * its other days: a month's percentage shared across that month's days. Even
 * when there is no phasing.
 */
function dayWeight(b: BudgetRecord, day: number): number {
  if (!b.months?.length) return 1;
  const month = b.months.find((m) => day >= dayNumber(m.start) && day <= dayNumber(m.end));
  if (!month) return 0;
  return month.percent / (dayNumber(month.end) - dayNumber(month.start) + 1);
}

export type BudgetShare = {
  /** Days no higher-priority budget had already taken. */
  ownDays: number;
  /** What higher-priority budgets put on this budget's other days. */
  claimed: number;
  /** Per own day. */
  dailyRate: number;
  /** Whether the total entered can be honoured. */
  holds: boolean;
};

export type Allocation = {
  shares: Map<string, BudgetShare>;
  /** Day number (UTC days since the epoch) → the budget that owns it and its amount. */
  days: Map<number, { budgetId: string; amount: number }>;
};

const CENT = 0.005;

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function byPriority(a: BudgetRecord, b: BudgetRecord): number {
  return b.priority - a.priority || a.start.localeCompare(b.start) || a.id.localeCompare(b.id);
}

/** Budgets that keep what their days carried in an earlier allocation — the override case. */
export type Keep = { ids: Set<string>; from: Allocation };

/**
 * Shares every budget's amount across its days, highest priority first.
 *
 * `keep` is the override case: each budget it names keeps, on each of its own
 * days, the amount that day carried in `keep.from`, and its amount is reported
 * as what its days then actually carry. Any other budget whose total cannot
 * hold puts nothing on its own days and is marked as not holding.
 */
export function allocate(budgets: BudgetRecord[], keep?: Keep): Allocation & { amounts: Map<string, number> } {
  const shares = new Map<string, BudgetShare>();
  const days = new Map<number, { budgetId: string; amount: number }>();
  const amounts = new Map<string, number>();

  for (const b of [...budgets].sort(byPriority)) {
    const first = dayNumber(b.start);
    const last = dayNumber(b.end);
    let claimed = 0;
    const own: number[] = [];
    for (let d = first; d <= last; d++) {
      const owner = days.get(d);
      if (owner) claimed += owner.amount;
      else own.push(d);
    }

    const remainder = b.amount - claimed;
    let holds = own.length > 0 ? remainder >= -CENT : Math.abs(remainder) <= CENT;
    let amount = b.amount;
    let perDay: (d: number) => number;

    if (keep?.ids.has(b.id)) {
      const previous = keep.from.days;
      const fallback = keep.from.shares.get(b.id)?.dailyRate ?? 0;
      perDay = (d) => (previous.get(d)?.budgetId === b.id ? previous.get(d)!.amount : fallback);
      amount = round2(claimed + own.reduce((s, d) => s + perDay(d), 0));
      holds = true;
    } else if (holds && own.length > 0) {
      const weights = own.map((d) => dayWeight(b, d));
      const total = weights.reduce((s, w) => s + w, 0);
      const spread = Math.max(0, remainder);
      // Phasing whose months fall entirely on days other budgets took leaves
      // nothing to weight by; the remainder then spreads evenly after all.
      perDay = total > 0 ? (d) => (spread * dayWeight(b, d)) / total : () => spread / own.length;
    } else {
      perDay = () => 0;
    }

    let carried = 0;
    for (const d of own) {
      const value = perDay(d);
      carried += value;
      days.set(d, { budgetId: b.id, amount: value });
    }
    shares.set(b.id, {
      ownDays: own.length,
      claimed: round2(claimed),
      dailyRate: own.length ? carried / own.length : 0,
      holds,
    });
    amounts.set(b.id, amount);
  }

  return { shares, days, amounts };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type PeriodBudget = {
  /** The budget for the period, from whichever budgets own its days. */
  amount: number;
  days: number;
  /** Days in the period no budget covers. */
  uncoveredDays: number;
  /** Which budgets contributed, largest first. */
  sources: { budgetId: string; label: string; amount: number }[];
};

export function budgetForPeriod(
  allocation: Allocation,
  budgets: BudgetRecord[],
  start: string,
  end: string
): PeriodBudget {
  const labelOf = new Map(budgets.map((b) => [b.id, b.label]));
  const bySource = new Map<string, number>();
  let amount = 0;
  let uncovered = 0;
  const first = dayNumber(start);
  const last = dayNumber(end);
  for (let d = first; d <= last; d++) {
    const owner = allocation.days.get(d);
    if (!owner) {
      uncovered++;
      continue;
    }
    amount += owner.amount;
    bySource.set(owner.budgetId, (bySource.get(owner.budgetId) ?? 0) + owner.amount);
  }
  return {
    amount: round2(amount),
    days: last - first + 1,
    uncoveredDays: uncovered,
    sources: [...bySource.entries()]
      .map(([budgetId, a]) => ({ budgetId, label: labelOf.get(budgetId) ?? "", amount: round2(a) }))
      .sort((a, b) => b.amount - a.amount),
  };
}

export type BudgetDraft = { id?: string; start: string; end: string; amount: number; label: string };

export type SavePlan = {
  /** The budgets as they would be saved, candidate included. */
  budgets: BudgetRecord[];
  candidateId: string;
  /** Budgets whose total the save would change, and to what. Empty when nothing conflicts. */
  changes: { budgetId: string; label: string; from: number; to: number }[];
};

export const NEW_BUDGET_ID = "new";

/**
 * What saving a budget does to a category's budgets.
 *
 * `plain` is the save as the rule has it — nothing else changes, or it would
 * conflict. `override` is what happens if the person overrides: the budget
 * being saved takes every day it covers, and the budgets it displaces move.
 * `conflicts` is true when `plain` cannot be saved as it stands.
 */
export function planBudgetSave(existing: BudgetRecord[], draft: BudgetDraft): {
  conflicts: boolean;
  plain: SavePlan;
  override: SavePlan;
} {
  const candidateId = draft.id ?? NEW_BUDGET_ID;
  const current = existing.find((b) => b.id === draft.id);
  const lowest = existing.length ? Math.min(...existing.map((b) => b.priority)) : 1;

  const candidate: BudgetRecord = {
    id: candidateId,
    start: draft.start,
    end: draft.end,
    amount: round2(draft.amount),
    // An edit keeps its place; a new budget goes beneath everything already set.
    priority: current ? current.priority : lowest - 1,
    label: draft.label,
    // An edit keeps its monthly phasing.
    months: current?.months,
  };

  const others = existing.filter((b) => b.id !== draft.id);
  const plainBudgets = [...others, candidate];
  const plainAllocation = allocate(plainBudgets);
  const conflicts = [...plainAllocation.shares.values()].some((s) => !s.holds);

  // The override. When the candidate itself cannot hold, it is lifted above
  // everything it overlaps, and every budget it displaces keeps its remaining
  // days at the daily amount they had before this save. When the candidate
  // holds but pushes a lower budget below zero, only the budgets that fail
  // keep their rates; the rest still recalculate to hold their totals.
  const before = allocate(existing);
  const candidateHolds = plainAllocation.shares.get(candidateId)?.holds ?? true;
  const highest = Math.max(candidate.priority, ...others.map((b) => b.priority));
  const lifted = candidateHolds ? candidate : { ...candidate, priority: highest + 1 };
  const overrideInput = [...others, lifted];

  const keep: Keep = { ids: new Set(), from: before };
  if (!candidateHolds) {
    for (const b of others) if (overlaps(b, lifted)) keep.ids.add(b.id);
  }
  let overrideAllocation = allocate(overrideInput, keep);
  // A budget that keeps its days' amounts changes what lies beneath it, which
  // can make a further one fail; each pass adds those, and the set only grows.
  for (let pass = 0; pass < overrideInput.length; pass++) {
    const failing = [...overrideAllocation.shares.entries()].filter(([id, s]) => !s.holds && id !== candidateId);
    if (failing.length === 0) break;
    for (const [id] of failing) keep.ids.add(id);
    overrideAllocation = allocate(overrideInput, keep);
  }

  const overrideBudgets = overrideInput.map((b) => ({ ...b, amount: overrideAllocation.amounts.get(b.id) ?? b.amount }));
  const changes = overrideBudgets
    .filter((b) => b.id !== candidateId)
    .map((b) => ({ budget: b, from: others.find((o) => o.id === b.id)!.amount }))
    .filter(({ budget, from }) => Math.abs(budget.amount - from) > CENT)
    .map(({ budget, from }) => ({ budgetId: budget.id, label: budget.label, from, to: budget.amount }));

  return {
    conflicts,
    plain: { budgets: plainBudgets, candidateId, changes: [] },
    override: { budgets: overrideBudgets, candidateId, changes },
  };
}

/** Whether two inclusive ranges share a day. */
export function overlaps(a: { start: string; end: string }, b: { start: string; end: string }): boolean {
  return a.start <= b.end && b.start <= a.end;
}

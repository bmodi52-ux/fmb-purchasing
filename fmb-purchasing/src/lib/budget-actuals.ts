/**
 * Actual spend against budgets, by category (#39), and the page's totals.
 *
 * Pure, so the arithmetic on the Budgets page is tested rather than trusted.
 * Budgets are set on leaf categories, so spend is gathered per leaf; what a
 * leaf can't hold is kept apart and named, because every dollar here must
 * still add up to what Reports says was spent:
 *
 *   paid + committed (over the leaves) + on parent categories + uncategorised
 *     = total spend
 */

export type SpendLine = { expenseId: string; categoryId: string | null; lineTotal: number };

export type LeafSpend = { spent: number; paid: number };

export type BudgetActuals = {
  /** Per leaf category. Leaves with no spend are absent. */
  byLeaf: Map<string, LeafSpend>;
  /**
   * Spend on a category that has subcategories. It is categorised — Reports
   * shows it under that category — but no budget row holds it, since budgets
   * are set on the subcategories. Largest first.
   */
  onParentCategories: { categoryId: string; amount: number }[];
  /** Spend with no category, or one that no longer exists: surcharges, delivery, anything not yet classified. */
  uncategorised: number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

export function budgetActuals(
  lines: SpendLine[],
  statusByExpense: Map<string, string>,
  categories: { id: string; parent_category_id: string | null }[]
): BudgetActuals {
  const parentIds = new Set(categories.map((c) => c.parent_category_id).filter((id): id is string => id !== null));
  const known = new Set(categories.map((c) => c.id));

  const byLeaf = new Map<string, LeafSpend>();
  const onParent = new Map<string, number>();
  let uncategorised = 0;

  for (const line of lines) {
    const id = line.categoryId;
    if (!id || !known.has(id)) {
      uncategorised += line.lineTotal;
    } else if (parentIds.has(id)) {
      onParent.set(id, (onParent.get(id) ?? 0) + line.lineTotal);
    } else {
      const leaf = byLeaf.get(id) ?? { spent: 0, paid: 0 };
      leaf.spent += line.lineTotal;
      if (statusByExpense.get(line.expenseId) === "paid") leaf.paid += line.lineTotal;
      byLeaf.set(id, leaf);
    }
  }

  for (const leaf of byLeaf.values()) {
    leaf.spent = cents(leaf.spent);
    leaf.paid = cents(leaf.paid);
  }

  return {
    byLeaf,
    onParentCategories: [...onParent.entries()]
      .map(([categoryId, amount]) => ({ categoryId, amount: cents(amount) }))
      .filter((p) => p.amount !== 0)
      .sort((a, b) => b.amount - a.amount),
    uncategorised: cents(uncategorised),
  };
}

export type BudgetMonth = {
  key: string;
  label: string;
  start: string;
  end: string;
  /** What the budgets put in this month — their monthly phasing, where they have one. */
  budget: number;
  /** What the budgeted categories spent in it. */
  spent: number;
  cumulativeBudget: number;
  cumulativeSpent: number;
};

/**
 * Budget against actual a month at a time, for the budgeted categories only
 * — the same like-for-like as Remaining. Ramadan's budget is not a twelfth of
 * the year's (#39), so each month's share comes from `budgetFor`, which reads
 * the phasing; this only lines months, budgets and spend up. Pure.
 */
export function budgetByMonth(
  months: { key: string; label: string; start: string; end: string }[],
  budgetFor: (start: string, end: string) => number,
  spend: { date: string; categoryId: string | null; lineTotal: number }[],
  budgeted: Set<string>
): BudgetMonth[] {
  let cumulativeBudget = 0;
  let cumulativeSpent = 0;
  return months.map((m) => {
    const budget = cents(budgetFor(m.start, m.end));
    const spent = cents(
      spend
        .filter((s) => s.categoryId && budgeted.has(s.categoryId) && s.date >= m.start && s.date <= m.end)
        .reduce((sum, s) => sum + s.lineTotal, 0)
    );
    cumulativeBudget = cents(cumulativeBudget + budget);
    cumulativeSpent = cents(cumulativeSpent + spent);
    return { ...m, budget, spent, cumulativeBudget, cumulativeSpent };
  });
}

export type BudgetTotals = {
  /** Every budget set for the period. Zero when none is. */
  budgeted: number;
  /** Spend in the categories that have a budget — what the budgets are being used by. */
  spentAgainstBudgets: number;
  /** Budgeted less what those same categories spent. Null when nothing is budgeted. */
  remaining: number | null;
  /** Across every category row, budgeted or not. */
  paid: number;
  committed: number;
};

/**
 * The totals row. Remaining compares like with like: the budgets set, against
 * the spend in the categories they were set for. Spend in a category with no
 * budget used to be taken off it too, so leaving one category unbudgeted made
 * every other one look further through its money than it was.
 */
export function budgetTotals(rows: { budget: number | null; spent: number; paid: number }[]): BudgetTotals {
  const budgetedRows = rows.filter((r) => r.budget !== null);
  const budgeted = cents(budgetedRows.reduce((s, r) => s + (r.budget ?? 0), 0));
  const spentAgainstBudgets = cents(budgetedRows.reduce((s, r) => s + r.spent, 0));
  const paid = cents(rows.reduce((s, r) => s + r.paid, 0));
  return {
    budgeted,
    spentAgainstBudgets,
    remaining: budgetedRows.length > 0 ? cents(budgeted - spentAgainstBudgets) : null,
    paid,
    committed: cents(rows.reduce((s, r) => s + r.spent, 0) - paid),
  };
}

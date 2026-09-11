/**
 * Statuses an expense can have, and which of them count as spend.
 *
 * Declined and withdrawn expenses are records, not purchases (0044): they stay
 * on the submitter's list and their detail page, and are left out of reports,
 * budgets, per-unit costs and duplicate warnings. Kept in one place because
 * that exclusion is applied in a dozen queries, and one that forgot
 * 'withdrawn' would quietly count money nobody spent.
 */

export type ExpenseStatus = "submitted" | "approved" | "declined" | "paid" | "withdrawn";

export const NOT_SPEND_STATUSES = ["declined", "withdrawn"] as const;

/** For PostgREST: `.not("status", "in", NOT_SPEND_FILTER)`. */
export const NOT_SPEND_FILTER = `(${NOT_SPEND_STATUSES.join(",")})`;

export function isSpend(status: string): boolean {
  return !(NOT_SPEND_STATUSES as readonly string[]).includes(status);
}

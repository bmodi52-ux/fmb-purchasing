import { userCan } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * Who may look at one particular expense.
 *
 * Kept in one place because two things enforce it — the detail page and the
 * signed receipt URL — and if they ever disagreed, the weaker one would
 * become the real rule. A reviewer's or payer's grant is enough on its own:
 * they need to see submissions that aren't theirs in order to act on them,
 * and neither grant is given to someone who shouldn't see spending.
 */
export async function canViewExpense(
  user: CurrentUser,
  submittedBy: string
): Promise<boolean> {
  if (submittedBy === user.id) return true;
  return (
    (await userCan(user, "all_expenses", "view")) ||
    (await userCan(user, "approvals", "approve")) ||
    (await userCan(user, "payments", "mark_paid"))
  );
}

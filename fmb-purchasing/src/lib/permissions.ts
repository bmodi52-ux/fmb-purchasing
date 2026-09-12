import { cache } from "react";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentUser } from "@/lib/auth/session";
import { activeDutiesFor, grantsForDuty } from "@/lib/stand-ins";
import { todayIso } from "@/lib/periods-data";

export type PageKey =
  | "submit_expense"
  | "my_submissions"
  | "all_expenses"
  | "pricelist"
  | "vendors"
  | "approvals"
  | "payments"
  | "reports"
  | "review_queue"
  | "budgets"
  | "admin_users"
  | "admin_teams"
  // Split out of payments/admin_users by 0057, so each can be granted alone.
  | "accounting"
  | "announcements"
  | "app_settings"
  | "records";

export type ActionKey =
  | "view"
  | "submit"
  | "edit_own"
  | "approve"
  | "mark_paid"
  | "edit_master_data"
  | "approve_master_data"
  | "manage_users"
  | "manage_teams"
  | "export"
  | "manage";

/**
 * All (page, action) grants the user holds: everything their teams grant, and
 * whatever duty they are standing in for today (#35).
 *
 * Cached per request. The user object comes from getCurrentUser, which is
 * itself cached, so every call in a request passes the same object.
 */
export const getUserPermissions = cache(async (
  user: Pick<CurrentUser, "id" | "teamIds">
): Promise<Set<`${string}:${string}`>> => {
  const admin = createAdminClient();

  const [{ data }, duties] = await Promise.all([
    user.teamIds.length
      ? admin.from("team_permissions").select("page_key, action_key").in("team_id", user.teamIds)
      : Promise.resolve({ data: [] as { page_key: string; action_key: string }[] }),
    activeDutiesFor(admin, user.id, todayIso()),
  ]);

  return new Set([
    ...(data ?? []).map((row) => `${row.page_key}:${row.action_key}` as const),
    ...duties.flatMap(grantsForDuty),
  ]);
});

export function can(
  permissions: Set<`${string}:${string}`>,
  page: PageKey,
  action: ActionKey
): boolean {
  return permissions.has(`${page}:${action}`);
}

/** Convenience for a single check without pre-fetching the whole set. */
export async function userCan(
  user: CurrentUser,
  page: PageKey,
  action: ActionKey
): Promise<boolean> {
  const permissions = await getUserPermissions(user);
  return can(permissions, page, action);
}

/** Redirects to "/" if the user lacks the given grant. Use at the top of a page. */
export async function requirePermission(
  user: CurrentUser,
  page: PageKey,
  action: ActionKey
): Promise<void> {
  if (!(await userCan(user, page, action))) {
    redirect("/");
  }
}

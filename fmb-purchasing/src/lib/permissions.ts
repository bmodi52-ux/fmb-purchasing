import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentUser } from "@/lib/auth/session";

export type PageKey =
  | "submit_expense"
  | "my_submissions"
  | "all_expenses"
  | "pricelist"
  | "vendors"
  | "approvals"
  | "payments"
  | "reports"
  | "admin_users"
  | "admin_teams";

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
  | "export";

/** All (page, action) grants across every team the user belongs to. */
export async function getUserPermissions(
  teamIds: string[]
): Promise<Set<`${string}:${string}`>> {
  if (teamIds.length === 0) return new Set();

  const admin = createAdminClient();
  const { data } = await admin
    .from("team_permissions")
    .select("page_key, action_key")
    .in("team_id", teamIds);

  return new Set((data ?? []).map((row) => `${row.page_key}:${row.action_key}` as const));
}

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
  const permissions = await getUserPermissions(user.teamIds);
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

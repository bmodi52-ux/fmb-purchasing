"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { reportError } from "@/lib/errors";

/**
 * Every change here goes through an admin_* database function (0045), which
 * tells the access-change triggers who is acting. Writing to the tables
 * directly would still be recorded, but as a change made outside the app.
 */

async function requireTeamsAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "admin_teams", "manage_teams");
  return user;
}

async function run(
  userId: string,
  fn: string,
  args: Record<string, unknown>,
  failure: string
): Promise<void> {
  const { error } = await createAdminClient().rpc(fn, { p_actor: userId, ...args });
  if (error) {
    await reportError({ source: "teams-admin", error: error.message, detail: fn, userId });
    throw new Error(failure);
  }
  revalidatePath("/admin/teams");
}

export async function createTeam(formData: FormData) {
  const user = await requireTeamsAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  await run(user.id, "admin_create_team", { p_name: name }, "The team could not be created. Try again.");
}

export async function addTeamMember(formData: FormData) {
  const user = await requireTeamsAdmin();
  const teamId = String(formData.get("team_id"));
  const userId = String(formData.get("user_id"));
  if (!teamId || !userId) return;

  await run(
    user.id,
    "admin_set_membership",
    { p_team_id: teamId, p_user_id: userId, p_member: true },
    "The member could not be added. Try again."
  );
}

export async function removeTeamMember(formData: FormData) {
  const user = await requireTeamsAdmin();
  const teamId = String(formData.get("team_id"));
  const userId = String(formData.get("user_id"));
  if (!teamId || !userId) return;

  await run(
    user.id,
    "admin_set_membership",
    { p_team_id: teamId, p_user_id: userId, p_member: false },
    "The member could not be removed. Try again."
  );
}

export async function togglePermission(formData: FormData) {
  const user = await requireTeamsAdmin();
  const teamId = String(formData.get("team_id"));
  const pageKey = String(formData.get("page_key"));
  const actionKey = String(formData.get("action_key"));
  const granted = String(formData.get("granted")) === "true";
  if (!teamId || !pageKey || !actionKey) return;

  await run(
    user.id,
    "admin_set_permission",
    { p_team_id: teamId, p_page_key: pageKey, p_action_key: actionKey, p_granted: !granted },
    "The permission could not be changed. Try again."
  );
}

/**
 * Grant or revoke a whole row (every action on one page) or column (one
 * action on every page) in one go — the "all" toggles on the grid.
 *
 * The page and action lists come from the registry rather than the form, so a
 * posted key can only ever widen to cells that exist. One database call, so a
 * row is never left half granted.
 */
export async function setPermissionScope(formData: FormData) {
  const user = await requireTeamsAdmin();
  const teamId = String(formData.get("team_id"));
  const scope = String(formData.get("scope"));
  const key = String(formData.get("key"));
  const granted = String(formData.get("granted")) === "true";
  if (!teamId || !key || (scope !== "row" && scope !== "column")) return;

  const admin = createAdminClient();
  const [{ data: pages }, { data: actions }] = await Promise.all([
    admin.from("app_pages").select("key").eq("is_permission_scope", true),
    admin.from("app_actions").select("key"),
  ]);
  const pageKeys = (pages ?? []).map((p) => p.key as string);
  const actionKeys = (actions ?? []).map((a) => a.key as string);

  const targetPages = scope === "row" ? pageKeys.filter((p) => p === key) : pageKeys;
  const targetActions = scope === "column" ? actionKeys.filter((a) => a === key) : actionKeys;
  if (targetPages.length === 0 || targetActions.length === 0) return;

  await run(
    user.id,
    "admin_set_permissions",
    { p_team_id: teamId, p_pages: targetPages, p_actions: targetActions, p_granted: granted },
    "Those permissions could not be changed. Try again."
  );
}

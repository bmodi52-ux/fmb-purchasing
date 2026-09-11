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

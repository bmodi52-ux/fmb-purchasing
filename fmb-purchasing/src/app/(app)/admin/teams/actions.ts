"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";

async function requireTeamsAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "admin_teams", "manage_teams");
  return user;
}

export async function createTeam(formData: FormData) {
  await requireTeamsAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const admin = createAdminClient();
  await admin.from("teams").insert({ name });
  revalidatePath("/admin/teams");
}

export async function addTeamMember(formData: FormData) {
  await requireTeamsAdmin();
  const teamId = String(formData.get("team_id"));
  const userId = String(formData.get("user_id"));
  if (!teamId || !userId) return;

  const admin = createAdminClient();
  await admin.from("team_members").insert({ team_id: teamId, user_id: userId });
  revalidatePath("/admin/teams");
}

export async function removeTeamMember(formData: FormData) {
  await requireTeamsAdmin();
  const teamId = String(formData.get("team_id"));
  const userId = String(formData.get("user_id"));
  if (!teamId || !userId) return;

  const admin = createAdminClient();
  await admin
    .from("team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("user_id", userId);
  revalidatePath("/admin/teams");
}

export async function togglePermission(formData: FormData) {
  await requireTeamsAdmin();
  const teamId = String(formData.get("team_id"));
  const pageKey = String(formData.get("page_key"));
  const actionKey = String(formData.get("action_key"));
  const granted = String(formData.get("granted")) === "true";

  const admin = createAdminClient();
  if (granted) {
    await admin
      .from("team_permissions")
      .delete()
      .eq("team_id", teamId)
      .eq("page_key", pageKey)
      .eq("action_key", actionKey);
  } else {
    await admin
      .from("team_permissions")
      .insert({ team_id: teamId, page_key: pageKey, action_key: actionKey });
  }
  revalidatePath("/admin/teams");
}

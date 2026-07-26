"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { usernameToAuthEmail, isValidUsername, normalizeUsername } from "@/lib/auth/username";

export type CreateUserState = { error: string | null };

async function requireUsersAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "admin_users", "manage_users");
  return user;
}

export async function createUser(
  _prevState: CreateUserState,
  formData: FormData
): Promise<CreateUserState> {
  await requireUsersAdmin();

  const usernameRaw = String(formData.get("username") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const contactEmail = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const username = normalizeUsername(usernameRaw);

  if (!isValidUsername(username)) {
    return {
      error: "Username must be 3-32 characters: lowercase letters, numbers, dots, dashes, underscores.",
    };
  }
  if (!fullName || !contactEmail || password.length < 8) {
    return { error: "Full name, contact email, and an 8+ character password are required." };
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: usernameToAuthEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username, full_name: fullName, contact_email: contactEmail },
  });

  if (error) {
    return { error: error.message.includes("already been registered") ? "That username is taken." : error.message };
  }

  revalidatePath("/admin/users");
  return { error: null };
}

export async function setUserActive(formData: FormData) {
  await requireUsersAdmin();
  const userId = String(formData.get("user_id"));
  const active = String(formData.get("active")) === "true";

  const admin = createAdminClient();
  await admin.from("profiles").update({ is_active: !active }).eq("id", userId);
  revalidatePath("/admin/users");
}

export async function bulkSetUserActive(userIds: string[], active: boolean) {
  await requireUsersAdmin();
  if (userIds.length === 0) return;

  const admin = createAdminClient();
  await admin.from("profiles").update({ is_active: active }).in("id", userIds);
  revalidatePath("/admin/users");
}

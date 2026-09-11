"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { generateTemporaryPassword, normalizeEmail, isValidEmail } from "@/lib/auth/password";
import { sendWelcomeEmail, sendTemporaryPasswordEmail } from "@/lib/auth/emails";
import { userIdsWithPermission } from "@/lib/notifications-inapp";
import { reportError } from "@/lib/errors";

/**
 * A temporary password exists in exactly two places: the email that carries
 * it, and this response. It is never stored, and can't be read back — so it
 * is returned to the admin who created it, and shown once, in case the email
 * doesn't arrive.
 */
export type IssuedCredentials = {
  fullName: string;
  email: string;
  temporaryPassword: string;
  emailed: boolean;
};

export type CreateUserState = {
  error: string | null;
  created: IssuedCredentials | null;
};

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

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!fullName) {
    return { error: "Enter the person's full name.", created: null };
  }
  if (!isValidEmail(email)) {
    return { error: "Enter a valid email address.", created: null };
  }

  const temporaryPassword = generateTemporaryPassword();

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    // The address is confirmed on the admin's word; there is no self-signup,
    // and a confirmation round trip would only delay first sign-in.
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      contact_email: email,
      must_change_password: true,
    },
  });

  if (error) {
    return {
      error: error.message.includes("already been registered")
        ? "An account already exists with that email address."
        : error.message,
      created: null,
    };
  }

  const emailed = await sendWelcomeEmail({ to: email, fullName, temporaryPassword });

  revalidatePath("/admin/users");
  return { error: null, created: { fullName, email, temporaryPassword, emailed } };
}

export type ResetPasswordState = {
  error: string | null;
  issued: IssuedCredentials | null;
};

/**
 * Admin fallback for someone who can't use the self-service reset — no
 * access to their mailbox, or the address on file is wrong. Issues a fresh
 * temporary password and forces a change at next sign-in.
 */
export async function adminResetPassword(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  await requireUsersAdmin();

  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return { error: "No user selected.", issued: null };

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .single();

  if (!profile) return { error: "That user no longer exists.", issued: null };

  const temporaryPassword = generateTemporaryPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    password: temporaryPassword,
  });

  if (error) return { error: error.message, issued: null };

  // Set after the password lands, so a failed update can't leave someone
  // locked into a change prompt with a password that still works.
  await admin.from("profiles").update({ must_change_password: true }).eq("id", userId);

  const emailed = await sendTemporaryPasswordEmail({
    to: profile.email,
    fullName: profile.full_name,
    temporaryPassword,
  });

  revalidatePath("/admin/users");
  return {
    error: null,
    issued: { fullName: profile.full_name, email: profile.email, temporaryPassword, emailed },
  };
}

/**
 * Deactivating these people would leave nobody able to administer accounts.
 *
 * Nothing prevented that: an admin could disable themselves, or the last
 * remaining holder of manage_users, and the only route back would be the
 * Supabase dashboard. Returns the subset of `userIds` that must stay active.
 */
async function wouldStrandUserAdmin(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<string[]> {
  const adminIds = await userIdsWithPermission(admin, "admin_users", "manage_users");
  const remaining = adminIds.filter((id) => !userIds.includes(id));
  return remaining.length > 0 ? [] : adminIds.filter((id) => userIds.includes(id));
}

/**
 * Turns accounts on or off.
 *
 * Takes the state to apply, not the state to flip. The old pair took opposite
 * things under near-identical names — setUserActive received the *current*
 * value and inverted it, bulkSetUserActive received the *desired* value — which
 * is the sort of thing a future caller gets wrong exactly once, silently, on
 * the action that locks people out of the system.
 */
async function applyActive(actorId: string, userIds: string[], active: boolean): Promise<void> {
  if (userIds.length === 0) return;
  const admin = createAdminClient();

  const protectedIds = active ? [] : await wouldStrandUserAdmin(admin, userIds);
  const toChange = userIds.filter((id) => !protectedIds.includes(id));
  if (toChange.length === 0) return;

  // Through admin_set_active (0045) so the access-change record names who did it.
  const { error } = await admin.rpc("admin_set_active", {
    p_actor: actorId,
    p_user_ids: toChange,
    p_active: active,
  });
  if (error) {
    await reportError({ source: "users-admin", error: error.message, userId: actorId });
    throw new Error("The accounts could not be changed. Try again.");
  }
  revalidatePath("/admin/users");
  revalidatePath("/admin/teams");
}

export async function setUserActive(formData: FormData) {
  const user = await requireUsersAdmin();
  const userId = String(formData.get("user_id"));
  // The form posts what the account should become, so this reads the same way
  // as the bulk call and as the button the person clicked.
  const active = String(formData.get("active")) === "true";
  if (userId) await applyActive(user.id, [userId], active);
}

export async function bulkSetUserActive(userIds: string[], active: boolean) {
  const user = await requireUsersAdmin();
  await applyActive(user.id, userIds, active);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { generateTemporaryPassword, normalizeEmail, isValidEmail } from "@/lib/auth/password";
import { sendWelcomeEmail, sendTemporaryPasswordEmail } from "@/lib/auth/emails";

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

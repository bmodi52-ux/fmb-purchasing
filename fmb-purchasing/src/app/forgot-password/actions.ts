"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, isValidEmail } from "@/lib/auth/password";
import { sendPasswordResetEmail } from "@/lib/auth/emails";
import { SITE_URL } from "@/lib/notifications";

export type ForgotPasswordState = { error: string | null; sent: boolean };

/**
 * Supabase mints and validates the recovery token; only the delivery is ours.
 *
 * `generateLink` hands back the hashed token instead of mailing anything,
 * which lets the message go out through Resend with the same branding as the
 * rest of the app, and lets the link point straight at this app's own reset
 * page — so no Supabase redirect allowlist has to be kept in step.
 */
export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!isValidEmail(email)) {
    return { error: "Enter a valid email address.", sent: false };
  }

  const admin = createAdminClient();
  // Exact match, not ilike: `_` is a LIKE wildcard and is legal in an email
  // local part, so a pattern could reach a different account's address.
  // Addresses are normalised to lowercase on write and by migration 0017.
  const { data: profile } = await admin
    .from("profiles")
    .select("id, full_name, email, is_active")
    .eq("email", email)
    .maybeSingle();

  // A disabled account is treated exactly like a missing one: re-enabling it
  // is an admin's decision, and a reset link would otherwise hint that the
  // account exists.
  if (profile?.is_active) {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: profile.email,
    });

    if (error) {
      console.error("[auth] generateLink failed:", error.message);
    } else {
      const token = data.properties.hashed_token;
      await sendPasswordResetEmail({
        to: profile.email,
        fullName: profile.full_name,
        resetUrl: `${SITE_URL}/reset-password?token=${encodeURIComponent(token)}`,
      });
    }
  }

  // Always the same answer, whatever happened above — anything else lets an
  // outsider find out which addresses have accounts.
  return { error: null, sent: true };
}

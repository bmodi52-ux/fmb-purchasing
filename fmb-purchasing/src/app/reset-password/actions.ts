"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateNewPassword } from "@/lib/auth/password";

export type ResetPasswordState = { error: string | null };

export async function resetPassword(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!token) {
    return { error: "This reset link is incomplete. Request a new one." };
  }

  // Checked before the token is spent: a mistyped confirmation shouldn't
  // consume a single-use link and force the whole request again.
  const invalid = validateNewPassword(password, confirm);
  if (invalid) return { error: invalid };

  const supabase = await createClient();

  // Exchanges the recovery token for a real session. Supabase enforces
  // expiry and single use here, which is the reason this flow leans on its
  // tokens rather than a hand-rolled one.
  const { data, error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: token,
    type: "recovery",
  });

  if (verifyError || !data.user) {
    return {
      error: "This reset link has expired or has already been used. Request a new one.",
    };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) return { error: updateError.message };

  // Someone arriving here from an admin-issued temporary password has
  // satisfied the requirement by choosing their own.
  const admin = createAdminClient();
  await admin.from("profiles").update({ must_change_password: false }).eq("id", data.user.id);

  redirect("/");
}

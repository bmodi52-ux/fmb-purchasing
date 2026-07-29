"use server";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateNewPassword } from "@/lib/auth/password";

export type ChangePasswordState = { error: string | null };

export async function changePassword(
  _prevState: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const currentPassword = String(formData.get("current_password") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const invalid = validateNewPassword(password, confirm);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("must_change_password")
    .eq("id", user.id)
    .single();

  // Read server-side rather than trusted from the form: an admin-issued
  // temporary password has nothing to confirm, since the whole point of it
  // is to be replaced immediately. Everyone else has to prove they still
  // hold the current password, so an unattended signed-in session (a shared
  // or borrowed device) can't be hijacked into a silent takeover.
  if (!profile?.must_change_password) {
    if (!currentPassword) {
      return { error: "Enter your current password." };
    }

    // A one-off client that never touches the request's session cookies —
    // this only needs to know whether the credentials are right, not to
    // establish a session of its own.
    const verifier = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { error: verifyError } = await verifier.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
    });
    if (verifyError) {
      return { error: "Your current password is incorrect." };
    }
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // Supabase rejects a password identical to the current one, among others;
    // its message is clearer than anything generic this could substitute.
    return { error: error.message };
  }

  // profiles is default-deny under RLS (migration 0001), hence the admin client.
  await admin.from("profiles").update({ must_change_password: false }).eq("id", user.id);

  redirect("/");
}

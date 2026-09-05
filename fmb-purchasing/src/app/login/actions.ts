"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeEmail } from "@/lib/auth/password";
import {
  isSigninThrottled,
  recordFailedSignin,
  clearSigninAttempts,
} from "@/lib/auth/signin-throttle";

export type SignInState = { error: string | null };

export async function signIn(
  _prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email address and password." };
  }

  // Checked before the password is, so a locked-out attacker learns nothing
  // from how long the response takes or what it says.
  const verdict = await isSigninThrottled(email);
  if (!verdict.allowed) {
    return {
      error:
        `Too many sign-in attempts. Try again in about ${verdict.retryAfterMinutes} ` +
        `minute${verdict.retryAfterMinutes === 1 ? "" : "s"}, or reset your password using the link below.`,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    await recordFailedSignin(email);
    // Deliberately doesn't distinguish an unknown address from a wrong
    // password — the difference tells an outsider which accounts exist.
    return { error: "Incorrect email address or password." };
  }

  // A correct password ends the run of failures, so ordinary forgetfulness
  // never accumulates towards a lockout.
  await clearSigninAttempts(email);
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

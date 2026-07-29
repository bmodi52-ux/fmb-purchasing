"use server";

import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeEmail, isValidEmail } from "@/lib/auth/password";
import { sendPasswordResetEmail } from "@/lib/auth/emails";
import { SITE_URL } from "@/lib/notifications";
import { clientIp, isResetRateLimited, pruneResetAttempts } from "@/lib/auth/reset-throttle";
import { reportError } from "@/lib/errors";

export type ForgotPasswordState = { error: string | null; sent: boolean };

/**
 * Supabase mints and validates the recovery token; only the delivery is ours.
 *
 * `generateLink` hands back the hashed token instead of mailing anything,
 * which lets the message go out through Resend with the same branding as the
 * rest of the app, and lets the link point straight at this app's own reset
 * page — so no Supabase redirect allowlist has to be kept in step.
 *
 * Everything that depends on whether the account exists runs in `after()`,
 * once the response has already been sent. That is deliberate: doing the
 * lookup inline made a hit take ~650ms and a miss ~50ms, which told anyone
 * watching the clock which addresses have accounts, however carefully the
 * wording was kept identical.
 */
export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));

  if (!isValidEmail(email)) {
    return { error: "Enter a valid email address.", sent: false };
  }

  const ip = await clientIp();

  after(async () => {
    try {
      // Recorded for every attempt, existing account or not, so the ledger
      // itself can't be used to tell them apart.
      if (await isResetRateLimited(email, ip)) {
        console.warn(`[auth] reset request throttled for ${email}`);
        return;
      }

      const admin = createAdminClient();
      // Exact match, not ilike: `_` is a LIKE wildcard and is legal in an
      // email local part, so a pattern could reach a different account's
      // address. Addresses are normalised to lowercase on write and by
      // migration 0017.
      const { data: profile } = await admin
        .from("profiles")
        .select("id, full_name, email, is_active")
        .eq("email", email)
        .maybeSingle();

      // A disabled account is treated exactly like a missing one: re-enabling
      // it is an admin's decision, and a reset link would otherwise hint that
      // the account exists.
      if (profile?.is_active) {
        const { data, error } = await admin.auth.admin.generateLink({
          type: "recovery",
          email: profile.email,
        });

        if (error) {
          // Nobody can tell us this is broken: the page says the same thing
          // either way, so a person who never receives the link assumes they
          // typed the wrong address.
          await reportError({
            source: "password-reset",
            error: `generateLink failed: ${error.message}`,
            userId: profile.id,
          });
        } else {
          await sendPasswordResetEmail({
            to: profile.email,
            fullName: profile.full_name,
            resetUrl: `${SITE_URL}/reset-password?token=${encodeURIComponent(
              data.properties.hashed_token
            )}`,
          });
        }
      }

      await pruneResetAttempts();
    } catch (err) {
      // Nothing here can reach the user — the response is long gone — so a
      // failure must at least be recorded rather than vanishing.
      await reportError({ source: "password-reset", error: err });
    }
  });

  // Always the same answer, and always at the same speed.
  return { error: null, sent: true };
}

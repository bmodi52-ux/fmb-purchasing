import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp } from "@/lib/auth/reset-throttle";

/**
 * Rate limiting for sign-in, mirroring the forgot-password throttle in
 * reset-throttle.ts.
 *
 * Two ceilings for two different attacks. The per-address limit caps guessing
 * at one account, and is the one that matters: it cannot be evaded, because
 * the address is the thing being attacked. The per-IP limit catches somebody
 * spraying one common password across many addresses, and is looser because
 * a household or a masjid office can legitimately share an address.
 *
 * Both are set well above what a person who has forgotten which password they
 * used will ever reach. Someone locked out here is told how long to wait and
 * pointed at the reset link, which is the route they wanted anyway.
 */
const MAX_PER_EMAIL_PER_WINDOW = 8;
const MAX_PER_IP_PER_WINDOW = 30;
const WINDOW_MS = 15 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export type SigninVerdict = { allowed: true } | { allowed: false; retryAfterMinutes: number };

function minutesUntil(oldest: string | null | undefined): number {
  const freesAt = oldest ? new Date(oldest).getTime() + WINDOW_MS : Date.now();
  return Math.max(1, Math.ceil((freesAt - Date.now()) / 60000));
}

/** Whether this attempt should be refused before the password is even checked. */
export async function isSigninThrottled(email: string): Promise<SigninVerdict> {
  const admin = createAdminClient();
  const ip = await clientIp();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const [{ count: emailCount }, ipResult] = await Promise.all([
    admin
      .from("signin_attempts")
      .select("*", { count: "exact", head: true })
      .eq("email", email)
      .gte("attempted_at", since),
    ip
      ? admin
          .from("signin_attempts")
          .select("*", { count: "exact", head: true })
          .eq("ip", ip)
          .gte("attempted_at", since)
      : Promise.resolve({ count: 0 }),
  ]);

  const overEmail = (emailCount ?? 0) >= MAX_PER_EMAIL_PER_WINDOW;
  const overIp = (ipResult.count ?? 0) >= MAX_PER_IP_PER_WINDOW;
  if (!overEmail && !overIp) return { allowed: true };

  const query = admin
    .from("signin_attempts")
    .select("attempted_at")
    .gte("attempted_at", since)
    .order("attempted_at", { ascending: true })
    .limit(1);

  const { data: oldest } = overEmail
    ? await query.eq("email", email).maybeSingle()
    : await query.eq("ip", ip!).maybeSingle();

  return { allowed: false, retryAfterMinutes: minutesUntil(oldest?.attempted_at) };
}

/** Records a failure, and prunes the ledger after the response has gone out. */
export async function recordFailedSignin(email: string): Promise<void> {
  const admin = createAdminClient();
  const ip = await clientIp();
  await admin.from("signin_attempts").insert({ email, ip });

  after(async () => {
    const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
    const { error } = await admin.from("signin_attempts").delete().lt("attempted_at", cutoff);
    if (error) console.error("[auth] pruning sign-in attempts failed:", error.message);
  });
}

/**
 * Clears an address's history once they get in.
 *
 * Without this, four fumbled attempts followed by a correct password would
 * leave someone four short of a lockout for the next quarter of an hour, which
 * punishes exactly the ordinary forgetfulness this is not aimed at.
 */
export async function clearSigninAttempts(email: string): Promise<void> {
  const admin = createAdminClient();
  await admin.from("signin_attempts").delete().eq("email", email);
}

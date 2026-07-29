import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Rate limiting for the forgot-password endpoint.
 *
 * Two separate ceilings, because they defend against different things:
 * the per-address limit stops one person's inbox being flooded, and the
 * per-IP limit stops someone sweeping many addresses to find out which ones
 * have accounts.
 *
 * Both are generous enough that a real person clicking "send" again because
 * the first email was slow will not trip them.
 */
const MAX_PER_EMAIL_PER_HOUR = 3;
const MAX_PER_IP_PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;

/** How long ledger rows are kept before the next request prunes them. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * The caller's address, as far as it can be trusted.
 *
 * These headers are forwarded by the host's proxy and are spoofable in
 * general, which is why they only drive the secondary limit — the per-address
 * ceiling doesn't depend on them and can't be evaded by rotating IPs.
 */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  // x-forwarded-for is a chain: the original client is the leftmost entry.
  if (forwarded) return forwarded.split(",")[0]!.trim() || null;
  return h.get("x-real-ip");
}

/**
 * Records this attempt and reports whether it is over either ceiling.
 *
 * The attempt is written whether or not an account exists, so the ledger
 * can't be used to tell the difference. Returns true when the caller should
 * skip sending — never an error the endpoint surfaces differently, since the
 * response has to look identical in every case.
 */
export async function isResetRateLimited(email: string, ip: string | null): Promise<boolean> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const [{ count: emailCount }, ipResult] = await Promise.all([
    admin
      .from("password_reset_attempts")
      .select("*", { count: "exact", head: true })
      .eq("email", email)
      .gte("requested_at", since),
    ip
      ? admin
          .from("password_reset_attempts")
          .select("*", { count: "exact", head: true })
          .eq("ip", ip)
          .gte("requested_at", since)
      : Promise.resolve({ count: 0 }),
  ]);

  await admin.from("password_reset_attempts").insert({ email, ip });

  return (emailCount ?? 0) >= MAX_PER_EMAIL_PER_HOUR || (ipResult.count ?? 0) >= MAX_PER_IP_PER_HOUR;
}

/**
 * Drops rows past the retention window. Cheap at this scale and saves
 * standing up a scheduled job for one small table; call it from `after()` so
 * it never delays a response.
 */
export async function pruneResetAttempts(): Promise<void> {
  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
  const { error } = await admin.from("password_reset_attempts").delete().lt("requested_at", cutoff);
  if (error) console.error("[auth] pruning reset attempts failed:", error.message);
}

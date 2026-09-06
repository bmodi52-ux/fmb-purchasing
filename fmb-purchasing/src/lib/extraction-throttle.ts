import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A ceiling on how often one person can invoke receipt extraction.
 *
 * Not a defence against an outsider. There is no self-signup, accounts are
 * created by an admin, `is_active` is checked on every request and the action
 * is permission-gated, so every caller is a known member of the organisation.
 *
 * It is a backstop against an accident with a metered API. The specific
 * accident available was a client-side one: the upload control stayed live
 * while a request was in flight, so on a slow connection — a 3MB photo plus a
 * multi-second model call is easily twenty seconds on 4G — someone who saw
 * nothing happening tapped again, and the server ran the whole thing twice.
 * That is fixed at the source too, in the form; this is the floor under it.
 *
 * Deliberately generous. Someone working through a week of receipts in one
 * sitting might legitimately do thirty, so the limit has to catch a runaway
 * loop without ever touching a real person having a busy afternoon.
 *
 * Same shape and same pruning as password_reset_attempts (0019), so there is
 * one throttling pattern in this codebase rather than two.
 */
const MAX_PER_HOUR = 60;
const WINDOW_MS = 60 * 60 * 1000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

export type ThrottleVerdict = { allowed: true } | { allowed: false; retryAfterMinutes: number };

export async function checkExtractionThrottle(userId: string): Promise<ThrottleVerdict> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const { count } = await admin
    .from("extraction_attempts")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("requested_at", since);

  if ((count ?? 0) >= MAX_PER_HOUR) {
    // The oldest attempt in the window is when a slot next frees up.
    const { data: oldest } = await admin
      .from("extraction_attempts")
      .select("requested_at")
      .eq("user_id", userId)
      .gte("requested_at", since)
      .order("requested_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const freesAt = oldest ? new Date(oldest.requested_at).getTime() + WINDOW_MS : Date.now();
    return {
      allowed: false,
      retryAfterMinutes: Math.max(1, Math.ceil((freesAt - Date.now()) / 60000)),
    };
  }

  await admin.from("extraction_attempts").insert({ user_id: userId });

  // Pruned after the response, so nobody waits on housekeeping.
  after(async () => {
    const cutoff = new Date(Date.now() - RETENTION_MS).toISOString();
    const { error } = await admin.from("extraction_attempts").delete().lt("requested_at", cutoff);
    if (error) console.error("[extraction] pruning attempts failed:", error.message);
  });

  return { allowed: true };
}

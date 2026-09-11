import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Push notifications to the devices people have allowed (#28, migration 0050).
 *
 * Needs a VAPID key pair — the identity push services use to accept messages
 * from this app. Generate one with `npx web-push generate-vapid-keys` and set
 * NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a
 * mailto: address). Without them push is simply off: the settings page says
 * so, and nothing else fails.
 */

export type PushPayload = { title: string; body: string | null; url: string | null; tag?: string };

let configured: boolean | null = null;

export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return (configured = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@fmbpurchasing.com.au", publicKey, privateKey);
  return (configured = true);
}

/**
 * Sends to every device each person has allowed. A device the push service
 * reports gone (404/410) is forgotten, so a lost phone does not fail every
 * send for ever. Never throws.
 */
export async function sendPush(admin: SupabaseClient, sends: { userId: string; payload: PushPayload }[]): Promise<void> {
  if (sends.length === 0 || !pushConfigured()) return;

  const userIds = [...new Set(sends.map((s) => s.userId))];
  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (error || !subscriptions?.length) return;

  const byUser = new Map<string, typeof subscriptions>();
  for (const s of subscriptions) byUser.set(s.user_id as string, [...(byUser.get(s.user_id as string) ?? []), s]);

  const gone: string[] = [];
  const delivered: string[] = [];
  await Promise.all(
    sends.flatMap(({ userId, payload }) =>
      (byUser.get(userId) ?? []).map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint as string, keys: { p256dh: s.p256dh as string, auth: s.auth as string } },
            JSON.stringify(payload),
            { TTL: 60 * 60 * 24 }
          );
          delivered.push(s.id as string);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(s.id as string);
          else console.error("[push] send failed:", status, (err as Error).message);
        }
      })
    )
  );

  if (gone.length) await admin.from("push_subscriptions").delete().in("id", gone);
  if (delivered.length) {
    await admin.from("push_subscriptions").update({ last_sent_at: new Date().toISOString() }).in("id", delivered);
  }
}

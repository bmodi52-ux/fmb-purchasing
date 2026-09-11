"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * All of these scope by user_id as well as row id — a notification belongs to
 * one person, and the id alone must not be enough to mark someone else's read.
 */

export async function markNotificationRead(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const id = String(formData.get("notification_id") ?? "");
  if (!id) return;

  const admin = createAdminClient();
  await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("read_at", null);

  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

export async function clearReadNotifications() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  await admin.from("notifications").delete().eq("user_id", user.id).not("read_at", "is", null);

  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

/* ------------------------------------------------------------------ */
/* Settings — scratchpad #28                                           */
/* ------------------------------------------------------------------ */

const CHANNEL_VALUES = new Set(["in_app", "push", "email"]);

/**
 * One switch on the settings page. Required and app-locked channels are shown
 * switched on and disabled, so they never post here; a stray post for one
 * still does nothing, because channelState() puts those layers above a
 * person's own choice.
 */
export async function setNotificationPreference(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const kind = String(formData.get("kind") ?? "");
  const channel = String(formData.get("channel") ?? "");
  const enabled = String(formData.get("enabled")) === "true";
  if (!kind || !CHANNEL_VALUES.has(channel)) return;

  const { error } = await createAdminClient()
    .from("notification_preferences")
    .upsert({ user_id: user.id, kind, channel, enabled, updated_at: new Date().toISOString() });
  if (error) throw new Error("The setting could not be saved. Try again.");
  revalidatePath("/notifications/settings");
}

/** Back to whatever the person's teams start them with. */
export async function resetNotificationPreferences(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await createAdminClient().from("notification_preferences").delete().eq("user_id", user.id);
  revalidatePath("/notifications/settings");
}

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceLabel: string;
};

/** Remembers a device this person has allowed to receive push notifications. */
export async function savePushSubscription(input: PushSubscriptionInput): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!/^https:\/\//.test(input.endpoint) || !input.keys?.p256dh || !input.keys?.auth) return { ok: false };

  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        device_label: input.deviceLabel.slice(0, 80) || null,
      },
      { onConflict: "endpoint" }
    );
  revalidatePath("/notifications/settings");
  return { ok: !error };
}

export async function removePushSubscription(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const id = String(formData.get("subscription_id") ?? "");
  if (!id) return;
  await createAdminClient().from("push_subscriptions").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/notifications/settings");
}

/** A test push to this person's own devices, so they can see it works. */
export async function sendTestPush(): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { sendPush, pushConfigured } = await import("@/lib/web-push");
  if (!pushConfigured()) return { ok: false };
  await sendPush(createAdminClient(), [
    {
      userId: user.id,
      payload: { title: "Push notifications are on", body: "This is how FMB Purchasing will reach you.", url: "/notifications/settings" },
    },
  ]);
  return { ok: true };
}

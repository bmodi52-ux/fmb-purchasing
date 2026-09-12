"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { notify } from "@/lib/notifications-inapp";
import { KIND_BY_KEY, type NotificationKind } from "@/lib/notification-kinds";
import { ALERT_EVENTS, recipientsOf, type AlertEvent } from "@/lib/alert-rules";
import { reportError } from "@/lib/errors";

async function requireNotificationsAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "admin_users", "manage_users");
  return user;
}

const CHANNELS = new Set(["in_app", "push", "email"]);

/**
 * One cell of a team's notification settings (#28): standard (no row — the
 * app's default), on, off, or required.
 */
export async function setTeamNotificationDefault(formData: FormData): Promise<void> {
  const user = await requireNotificationsAdmin();
  const teamId = String(formData.get("team_id") ?? "");
  const kind = String(formData.get("kind") ?? "") as NotificationKind;
  const channel = String(formData.get("channel") ?? "");
  const value = String(formData.get("value") ?? "standard");
  if (!teamId || !KIND_BY_KEY.has(kind) || !CHANNELS.has(channel)) return;

  const admin = createAdminClient();
  const { error } =
    value === "standard"
      ? await admin.from("team_notification_defaults").delete().eq("team_id", teamId).eq("kind", kind).eq("channel", channel)
      : await admin.from("team_notification_defaults").upsert({
          team_id: teamId,
          kind,
          channel,
          enabled: value !== "off",
          required: value === "required",
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        });
  if (error) {
    await reportError({ source: "notification-defaults", error: error.message, userId: user.id });
    throw new Error("The setting could not be saved. Try again.");
  }
  revalidatePath("/admin/notifications");
}

export type AnnouncementState = { status: "idle" | "sent" | "error"; message?: string };

function ids(formData: FormData, key: string): string[] {
  return formData.getAll(key).map(String).filter(Boolean);
}

/** An announcement to everyone, chosen teams or chosen people. */
export async function sendAnnouncement(_prev: AnnouncementState, formData: FormData): Promise<AnnouncementState> {
  const user = await requireNotificationsAdmin();
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim() || null;
  const link = String(formData.get("link") ?? "").trim() || null;
  const everyone = formData.get("audience") === "everyone";
  const teamIds = everyone ? [] : ids(formData, "team_ids");
  const userIds = everyone ? [] : ids(formData, "user_ids");

  if (!title) return { status: "error", message: "Give the announcement a title." };
  if (link && !link.startsWith("/")) return { status: "error", message: "A link must be a page in the app, starting with /." };
  if (!everyone && teamIds.length === 0 && userIds.length === 0) {
    return { status: "error", message: "Choose who it goes to — everyone, or at least one team or person." };
  }

  const admin = createAdminClient();
  let recipients: string[];
  if (everyone) {
    const { data } = await admin.from("profiles").select("id").eq("is_active", true);
    recipients = (data ?? []).map((p) => p.id as string);
  } else {
    recipients = await recipientsOf(admin, { teamIds, userIds });
  }

  const { error } = await admin.from("announcements").insert({
    title,
    body,
    link,
    audience: everyone ? { everyone: true } : { teamIds, userIds },
    recipient_count: recipients.length,
    created_by: user.id,
  });
  if (error) {
    await reportError({ source: "announcements", error: error.message, userId: user.id });
    return { status: "error", message: "The announcement could not be sent. Try again." };
  }

  await notify(
    admin,
    recipients.map((userId) => ({ userId, kind: "announcement" as const, title, body, link: link ?? "/notifications" }))
  );
  revalidatePath("/admin/notifications");
  return { status: "sent", message: `Sent to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}.` };
}

export type AlertRuleState = { status: "idle" | "saved" | "error"; message?: string };

/** Builds a new alert rule from the form's parts. */
export async function saveAlertRule(_prev: AlertRuleState, formData: FormData): Promise<AlertRuleState> {
  const user = await requireNotificationsAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const event = String(formData.get("event") ?? "") as AlertEvent;
  const minAmountRaw = String(formData.get("min_amount") ?? "").replace(/[$,\s]/g, "");
  const percentRaw = String(formData.get("budget_percent") ?? "").trim();
  const calendar = String(formData.get("calendar") ?? "hijri");
  const categoryIds = ids(formData, "category_ids");
  const vendorIds = ids(formData, "vendor_ids");
  const teamIds = ids(formData, "team_ids");
  const userIds = ids(formData, "user_ids");

  if (!name) return { status: "error", message: "Give the alert a name people will recognise." };
  if (!ALERT_EVENTS.some((e) => e.event === event)) return { status: "error", message: "Choose when the alert happens." };
  if (teamIds.length === 0 && userIds.length === 0) return { status: "error", message: "Choose who to tell." };

  const minAmount = minAmountRaw ? Number(minAmountRaw) : null;
  if (minAmount !== null && (!Number.isFinite(minAmount) || minAmount < 0)) {
    return { status: "error", message: "The amount must be a number of dollars." };
  }
  const budgetPercent = percentRaw ? Number(percentRaw) : null;
  if (event === "budget_threshold" && (budgetPercent === null || !(budgetPercent > 0 && budgetPercent <= 500))) {
    return { status: "error", message: "A budget alert needs a percentage, such as 80." };
  }

  const { error } = await createAdminClient()
    .from("alert_rules")
    .insert({
      name,
      event,
      conditions: {
        ...(minAmount !== null && !["budget_threshold", "vendor_added", "price_change"].includes(event) ? { minAmount } : {}),
        ...(categoryIds.length && event !== "vendor_added" ? { categoryIds } : {}),
        ...(vendorIds.length && event !== "budget_threshold" ? { vendorIds } : {}),
        ...(event === "budget_threshold" ? { budgetPercent, calendar: ["hijri", "au", "cy"].includes(calendar) ? calendar : "hijri" } : {}),
      },
      recipients: { teamIds, userIds },
      created_by: user.id,
    });
  if (error) {
    await reportError({ source: "alert-rules", error: error.message, userId: user.id });
    return { status: "error", message: "The alert could not be saved. Try again." };
  }
  revalidatePath("/admin/notifications");
  return { status: "saved", message: `“${name}” is on.` };
}

export async function setAlertRuleActive(formData: FormData): Promise<void> {
  await requireNotificationsAdmin();
  const id = String(formData.get("rule_id") ?? "");
  const active = String(formData.get("active")) === "true";
  if (!id) return;
  await createAdminClient().from("alert_rules").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/notifications");
}

export async function deleteAlertRule(formData: FormData): Promise<void> {
  await requireNotificationsAdmin();
  const id = String(formData.get("rule_id") ?? "");
  if (!id) return;
  await createAdminClient().from("alert_rules").delete().eq("id", id);
  revalidatePath("/admin/notifications");
}

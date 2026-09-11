import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { channelState, type Channel, type NotificationKind, type TeamSetting } from "@/lib/notification-kinds";
import { sendPush } from "@/lib/web-push";
import { detailsBox, emailTemplate, sendEmail, SITE_URL } from "@/lib/notifications";
import { activeStandIns, dutyForGrant } from "@/lib/stand-ins";
import { todayIso } from "@/lib/periods-data";

export type { NotificationKind };

export type NotificationRow = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  expense_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationEntry = {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  expenseId?: string | null;
};

/**
 * Which channels each entry goes out on, from the recipients' own choices and
 * their teams' (#28). Reads everything for the whole batch in three queries.
 * Before migration 0050 has run the tables are missing, and every entry falls
 * back to the kind's defaults.
 */
async function channelsFor(
  admin: SupabaseClient,
  entries: NotificationEntry[]
): Promise<Map<NotificationEntry, Set<Channel>>> {
  const userIds = [...new Set(entries.map((e) => e.userId))];
  const kinds = [...new Set(entries.map((e) => e.kind))];

  const [{ data: prefs }, { data: memberships }] = await Promise.all([
    admin.from("notification_preferences").select("user_id, kind, channel, enabled").in("user_id", userIds).in("kind", kinds),
    admin.from("team_members").select("team_id, user_id").in("user_id", userIds),
  ]);
  const teamIds = [...new Set((memberships ?? []).map((m) => m.team_id as string))];
  const { data: defaults } = teamIds.length
    ? await admin.from("team_notification_defaults").select("team_id, kind, channel, enabled, required").in("team_id", teamIds).in("kind", kinds)
    : { data: [] };

  const own = new Map((prefs ?? []).map((p) => [`${p.user_id}:${p.kind}:${p.channel}`, p.enabled as boolean]));
  const teamsOf = new Map<string, string[]>();
  for (const m of memberships ?? []) teamsOf.set(m.user_id as string, [...(teamsOf.get(m.user_id as string) ?? []), m.team_id as string]);
  const teamSetting = new Map((defaults ?? []).map((d) => [`${d.team_id}:${d.kind}:${d.channel}`, { enabled: d.enabled, required: d.required } as TeamSetting]));

  const out = new Map<NotificationEntry, Set<Channel>>();
  for (const e of entries) {
    const channels = new Set<Channel>();
    for (const channel of ["in_app", "push", "email"] as Channel[]) {
      const teams = (teamsOf.get(e.userId) ?? [])
        .map((t) => teamSetting.get(`${t}:${e.kind}:${channel}`))
        .filter((t): t is TeamSetting => !!t);
      if (channelState(e.kind, channel, own.get(`${e.userId}:${e.kind}:${channel}`), teams).enabled) channels.add(channel);
    }
    out.set(e, channels);
  }
  return out;
}

/** Runs after the response when there is one, and straight away when there is not (a script, a test). */
function later(work: () => Promise<void>): void {
  try {
    after(work);
  } catch {
    void work();
  }
}

/**
 * Sends notifications, each on the channels its recipient has chosen.
 *
 * The in-app row is written before this returns; push and email go out after
 * the response, so approving forty expenses never waits on forty emails.
 * Notifications are a courtesy, not part of the transaction that changed
 * anything — a failure here must never roll back an approval or reach the
 * caller as an error, so it logs and moves on.
 */
export async function notify(admin: SupabaseClient, entries: NotificationEntry[]): Promise<void> {
  const rows = entries.filter((e) => e.userId);
  if (rows.length === 0) return;

  let channels: Map<NotificationEntry, Set<Channel>>;
  try {
    channels = await channelsFor(admin, rows);
  } catch {
    channels = new Map(rows.map((e) => [e, new Set<Channel>(["in_app"])]));
  }

  const inApp = rows.filter((e) => channels.get(e)?.has("in_app"));
  if (inApp.length > 0) {
    const { error } = await admin.from("notifications").insert(
      inApp.map((e) => ({
        user_id: e.userId,
        kind: e.kind,
        title: e.title,
        body: e.body ?? null,
        link: e.link ?? null,
        expense_id: e.expenseId ?? null,
      }))
    );
    // Deliberately console.error and not reportError: reporting an error
    // notifies admins, which calls straight back into here. If writing
    // notifications is what's broken, that recurses until something gives.
    if (error) console.error("[notifications] could not record:", error.message);
  }

  const pushes = rows.filter((e) => channels.get(e)?.has("push"));
  const emails = rows.filter((e) => channels.get(e)?.has("email"));
  if (pushes.length === 0 && emails.length === 0) return;

  later(async () => {
    try {
      await sendPush(
        admin,
        pushes.map((e) => ({
          userId: e.userId,
          payload: {
            title: e.title,
            body: e.body ?? null,
            url: e.expenseId ? `/expenses/${e.expenseId}` : (e.link ?? "/notifications"),
            tag: e.expenseId ?? undefined,
          },
        }))
      );
      await sendNotificationEmails(admin, emails);
    } catch (err) {
      console.error("[notifications] delivery failed:", err);
    }
  });
}

async function sendNotificationEmails(admin: SupabaseClient, entries: NotificationEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const { data: people } = await admin
    .from("profiles")
    .select("id, email, is_active")
    .in("id", [...new Set(entries.map((e) => e.userId))]);
  const emailOf = new Map((people ?? []).filter((p) => p.is_active).map((p) => [p.id as string, p.email as string]));

  for (const e of entries) {
    const to = emailOf.get(e.userId);
    if (!to) continue;
    const link = `${SITE_URL}${e.expenseId ? `/expenses/${e.expenseId}` : (e.link ?? "/notifications")}`;
    await sendEmail({
      to,
      subject: e.title,
      html: emailTemplate(
        `<p style="margin:0 0 10px 0; font-size:16px; font-weight:600;">${escapeHtml(e.title)}</p>` +
          (e.body ? `<p style="margin:0 0 14px 0; white-space:pre-line;">${escapeHtml(e.body)}</p>` : "") +
          detailsBox([{ label: "Open", value: `<a href="${link}" style="color:#A97614;">In the app</a>` }]) +
          `<p style="margin:12px 0 0 0; font-size:12px; color:#8A7B6C;">You can choose which notifications arrive by email in the app, under Notifications → Settings.</p>`
      ),
    });
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/**
 * Active users who hold a grant — who to tell. Includes anyone standing in for
 * that duty today (#35), since they are the person the work is waiting on.
 */
export async function userIdsWithPermission(
  admin: SupabaseClient,
  page: string,
  action: string
): Promise<string[]> {
  const { data: teams } = await admin
    .from("team_permissions")
    .select("team_id")
    .eq("page_key", page)
    .eq("action_key", action);
  const teamIds = [...new Set((teams ?? []).map((t) => t.team_id))];

  const { data: members } = teamIds.length
    ? await admin.from("team_members").select("user_id").in("team_id", teamIds)
    : { data: [] };
  const userIds = new Set((members ?? []).map((m) => m.user_id as string));

  const duty = dutyForGrant(page, action);
  if (duty) for (const s of await activeStandIns(admin, todayIso(), duty)) userIds.add(s.stand_in_id);

  if (userIds.size === 0) return [];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id")
    .in("id", [...userIds])
    .eq("is_active", true);
  return (profiles ?? []).map((p) => p.id);
}

export async function unreadCount(userId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  return count ?? 0;
}

export async function recentNotifications(userId: string, limit = 30): Promise<NotificationRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("notifications")
    .select("id, kind, title, body, link, expense_id, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as NotificationRow[];
}

import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationKind =
  | "expense_submitted"
  | "expense_to_review"
  | "expense_approved"
  | "expense_declined"
  | "expense_paid"
  | "system_error";

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

/**
 * Writes one row per recipient. Notifications are a courtesy, not part of the
 * transaction that changed the expense — a failure here must never roll back
 * an approval or leave the caller with an error, so it logs and moves on.
 */
export async function notify(
  admin: SupabaseClient,
  entries: {
    userId: string;
    kind: NotificationKind;
    title: string;
    body?: string | null;
    link?: string | null;
    expenseId?: string | null;
  }[]
): Promise<void> {
  const rows = entries.filter((e) => e.userId);
  if (rows.length === 0) return;

  const { error } = await admin.from("notifications").insert(
    rows.map((e) => ({
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

/** Active users whose team grants the given permission — who to tell. */
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
  if (teamIds.length === 0) return [];

  const { data: members } = await admin.from("team_members").select("user_id").in("team_id", teamIds);
  const userIds = [...new Set((members ?? []).map((m) => m.user_id))];
  if (userIds.length === 0) return [];

  const { data: profiles } = await admin
    .from("profiles")
    .select("id")
    .in("id", userIds)
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

import type { SupabaseClient } from "@supabase/supabase-js";
import { notify, userIdsWithPermission } from "@/lib/notifications-inapp";

/**
 * Backups and restore rehearsals (#45, migration 0055): what is overdue.
 *
 * A backup nobody has taken in a week, or a restore nobody has rehearsed in
 * six months, is said on the Records page and — once a week, on Mondays — to
 * whoever administers accounts.
 */

export const BACKUP_DUE_DAYS = 7;
export const REHEARSAL_DUE_DAYS = 183;

export type RecordsState = {
  lastDatabaseBackup: string | null;
  lastReceiptBackup: string | null;
  lastRehearsal: string | null;
};

function daysSince(instant: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(instant).getTime()) / 86_400_000);
}

/** What needs doing, in words, most urgent first. Empty when nothing is overdue. */
export function recordsAttention(state: RecordsState, now = new Date()): string[] {
  const due: string[] = [];
  const backup = (label: string, at: string | null) => {
    if (!at) due.push(`No ${label} backup has been recorded.`);
    else if (daysSince(at, now) > BACKUP_DUE_DAYS) due.push(`The last ${label} backup was ${daysSince(at, now)} days ago.`);
  };
  backup("database", state.lastDatabaseBackup);
  backup("receipt file", state.lastReceiptBackup);
  if (!state.lastRehearsal) due.push("No restore has been rehearsed yet.");
  else if (daysSince(state.lastRehearsal, now) > REHEARSAL_DUE_DAYS) {
    due.push(`The last restore rehearsal was ${Math.round(daysSince(state.lastRehearsal, now) / 30)} months ago.`);
  }
  return due;
}

export async function loadRecordsState(admin: SupabaseClient): Promise<RecordsState> {
  const latest = async (kind: "database" | "receipt_files") => {
    const { data } = await admin
      .from("backup_runs")
      .select("finished_at")
      .eq("kind", kind)
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.finished_at as string | undefined) ?? null;
  };
  const [lastDatabaseBackup, lastReceiptBackup, { data: rehearsal }] = await Promise.all([
    latest("database"),
    latest("receipt_files"),
    admin
      .from("restore_rehearsals")
      .select("rehearsed_on")
      .eq("succeeded", true)
      .order("rehearsed_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return { lastDatabaseBackup, lastReceiptBackup, lastRehearsal: (rehearsal?.rehearsed_on as string | undefined) ?? null };
}

/** The Monday reminder, from the daily job. */
export async function remindAboutRecords(admin: SupabaseClient, today: Date): Promise<number> {
  const due = recordsAttention(await loadRecordsState(admin), today);
  if (due.length === 0) return 0;
  const admins = await userIdsWithPermission(admin, "admin_users", "manage_users");
  await notify(
    admin,
    admins.map((userId) => ({
      userId,
      kind: "reminder" as const,
      title: "Backups and records need attention",
      body: due.join(" "),
      link: "/admin/records",
    }))
  );
  return admins.length;
}

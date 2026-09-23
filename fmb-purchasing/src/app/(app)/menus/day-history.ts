import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who changed a day's menu, and when (#15).
 *
 * Recorded after the change has happened, and never allowed to fail it: a
 * missing line of history is a pity, a menu change undone because the history
 * could not be written would be a bug.
 */

export type DayChange = {
  id: string;
  changedAt: string;
  changedBy: string | null;
  wasReleased: boolean;
  action: string;
  detail: string | null;
};

/** The day a row on it belongs to, for actions that are handed only the row. */
export async function dayOfRow(admin: SupabaseClient, table: string, rowId: string): Promise<string | null> {
  const { data } = await admin.from(table).select("menu_day_id").eq("id", rowId).maybeSingle();
  return (data?.menu_day_id as string | undefined) ?? null;
}

export async function logDayChange(
  admin: SupabaseClient,
  entry: { dayId: string | null; userId: string; action: string; detail?: string | null }
): Promise<void> {
  if (!entry.dayId) return;
  try {
    const { data: day } = await admin
      .from("menu_days")
      .select("kitchen_id, service_date, status")
      .eq("id", entry.dayId)
      .maybeSingle();
    if (!day) return;
    const { error } = await admin.from("menu_day_changes").insert({
      menu_day_id: entry.dayId,
      kitchen_id: day.kitchen_id,
      service_date: day.service_date,
      changed_by: entry.userId,
      was_released: day.status === "released",
      action: entry.action,
      detail: entry.detail ?? null,
    });
    if (error) console.error("[menu-history] could not record:", error.message);
  } catch (err) {
    console.error("[menu-history] could not record:", err);
  }
}

/** A day's history, newest first, with who made each change. */
export async function loadDayChanges(
  admin: SupabaseClient,
  kitchenId: string,
  date: string
): Promise<DayChange[]> {
  const { data } = await admin
    .from("menu_day_changes")
    .select("id, changed_at, changed_by, was_released, action, detail")
    .eq("kitchen_id", kitchenId)
    .eq("service_date", date)
    .order("changed_at", { ascending: false })
    .limit(200);
  const ids = [...new Set((data ?? []).map((r) => r.changed_by).filter(Boolean) as string[])];
  const { data: people } = ids.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id as string, (p.full_name || p.email) as string]));
  return (data ?? []).map((r) => ({
    id: r.id as string,
    changedAt: r.changed_at as string,
    changedBy: r.changed_by ? (nameOf.get(r.changed_by as string) ?? null) : null,
    wasReleased: Boolean(r.was_released),
    action: r.action as string,
    detail: (r.detail as string | null) ?? null,
  }));
}

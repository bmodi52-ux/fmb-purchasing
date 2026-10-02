import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A person's favourite reports (0088): the registry keys they have starred.
 *
 * Reading never throws. A favourite is a convenience, and a report page that
 * failed to open because its star could not be read would be a poor trade —
 * so if the table cannot be read, there are simply no favourites.
 */
export async function loadFavouriteReports(admin: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await admin.from("report_favourites").select("report_key").eq("user_id", userId).order("created_at");
  if (error) return [];
  return (data ?? []).map((r) => r.report_key as string);
}

/** Stars or unstars a report for someone. Returns whether it is now a favourite. */
export async function setFavouriteReport(admin: SupabaseClient, userId: string, reportKey: string, favourite: boolean): Promise<boolean> {
  if (favourite) {
    const { error } = await admin
      .from("report_favourites")
      .upsert({ user_id: userId, report_key: reportKey }, { onConflict: "user_id,report_key", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return true;
  }
  const { error } = await admin.from("report_favourites").delete().eq("user_id", userId).eq("report_key", reportKey);
  if (error) throw new Error(error.message);
  return false;
}

/** Favourites first, in the order they were starred; then the rest, as they come. */
export function favouritesFirst<T extends { key: string }>(reports: T[], favourites: string[]): T[] {
  const rank = new Map(favourites.map((key, i) => [key, i]));
  // Unstarred reports all rank alike, so the sort (which is stable) leaves them as they came.
  const UNSTARRED = Number.MAX_SAFE_INTEGER;
  return [...reports].sort((a, b) => (rank.get(a.key) ?? UNSTARRED) - (rank.get(b.key) ?? UNSTARRED));
}

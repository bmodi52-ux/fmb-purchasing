import { createAdminClient } from "@/lib/supabase/admin";

/** Per-user, per-page column visibility (§6) — persisted server-side. */
export async function getColumnPreference(
  userId: string,
  pageKey: string,
  defaultColumns: string[]
): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_column_preferences")
    .select("visible_columns")
    .eq("user_id", userId)
    .eq("page_key", pageKey)
    .maybeSingle();

  if (!data || !Array.isArray(data.visible_columns) || data.visible_columns.length === 0) {
    return defaultColumns;
  }
  return data.visible_columns as string[];
}

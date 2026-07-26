"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";

export async function saveColumnPreference(pageKey: string, columns: string[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  await admin
    .from("user_column_preferences")
    .upsert(
      { user_id: user.id, page_key: pageKey, visible_columns: columns, updated_at: new Date().toISOString() },
      { onConflict: "user_id,page_key" }
    );
}

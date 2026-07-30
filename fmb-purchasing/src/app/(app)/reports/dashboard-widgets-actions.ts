"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import type { WidgetKind, WidgetConfig } from "./dashboard-widgets";

/**
 * All of these scope by user_id as well as row id — a widget belongs to one
 * person's dashboard, and the id alone must not be enough to edit or reorder
 * someone else's.
 */

export async function addDashboardWidget(kind: WidgetKind, title: string, config: WidgetConfig) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: last } = await admin
    .from("user_dashboard_widgets")
    .select("sort_order")
    .eq("user_id", user.id)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  await admin.from("user_dashboard_widgets").insert({
    user_id: user.id,
    kind,
    title,
    config,
    sort_order: (last?.sort_order ?? -1) + 1,
  });

  revalidatePath("/");
}

export async function updateDashboardWidget(
  id: string,
  updates: { title?: string; config?: WidgetConfig }
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  await admin
    .from("user_dashboard_widgets")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id);

  revalidatePath("/");
}

export async function removeDashboardWidget(id: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  await admin.from("user_dashboard_widgets").delete().eq("id", id).eq("user_id", user.id);

  revalidatePath("/");
}

/** `orderedIds` is the widget list top-to-bottom as the user just left it. */
export async function reorderDashboardWidgets(orderedIds: string[]) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  await Promise.all(
    orderedIds.map((id, index) =>
      admin
        .from("user_dashboard_widgets")
        .update({ sort_order: index })
        .eq("id", id)
        .eq("user_id", user.id)
    )
  );

  revalidatePath("/");
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { canSeeReport } from "@/lib/reporting/registry";
import { specFrom, storedWidget } from "@/lib/reporting/widgets";

/**
 * All of these scope by user_id as well as row id — a widget belongs to one
 * person's dashboard, and the id alone must not be enough to edit or reorder
 * someone else's.
 *
 * A widget is saved as a spec (lib/reporting/widgets): checked here, since it
 * arrives from the browser, and only for a report its owner can see.
 */

async function checkedSpec(raw: unknown) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const spec = specFrom(raw);
  if (!spec) throw new Error("That isn't a widget this dashboard can show.");
  if (!(await canSeeReport(user, spec.report))) throw new Error("You can't see that report.");
  return { user, spec };
}

const cleanTitle = (title: string) => title.trim().slice(0, 120) || "Widget";

export async function addDashboardWidget(raw: unknown, title: string) {
  const { user, spec } = await checkedSpec(raw);

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
    ...storedWidget(spec),
    title: cleanTitle(title),
    sort_order: (last?.sort_order ?? -1) + 1,
  });

  revalidatePath("/");
}

/** Saving an edited widget writes it in the current shape, whatever it was saved in before. */
export async function updateDashboardWidget(id: string, raw: unknown, title: string) {
  const { user, spec } = await checkedSpec(raw);

  const admin = createAdminClient();
  await admin
    .from("user_dashboard_widgets")
    .update({ ...storedWidget(spec), title: cleanTitle(title), updated_at: new Date().toISOString() })
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

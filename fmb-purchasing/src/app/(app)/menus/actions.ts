"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";

/**
 * Planning a day: what is being cooked, and for how many (#70).
 *
 * A menu day row is made the moment anything is said about the day, so the
 * page never has to ask whether it exists first.
 */

async function requirePlanner() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "manage");
  return user;
}

/** The day's row, made if this is the first thing said about it. */
async function menuDayId(
  admin: ReturnType<typeof createAdminClient>,
  kitchenId: string,
  date: string,
  userId: string
): Promise<string | null> {
  const { data: existing } = await admin
    .from("menu_days")
    .select("id")
    .eq("kitchen_id", kitchenId)
    .eq("service_date", date)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: created } = await admin
    .from("menu_days")
    .insert({ kitchen_id: kitchenId, service_date: date, created_by: userId, updated_by: userId })
    .select("id")
    .single();
  return (created?.id as string) ?? null;
}

function refresh(date: string) {
  revalidatePath("/menus");
  revalidatePath(`/menus/${date}`);
}

export async function addDishToDay(formData: FormData) {
  const user = await requirePlanner();
  const kitchenId = String(formData.get("kitchen_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const dishId = String(formData.get("dish_id") ?? "");
  if (!kitchenId || !date || !dishId) return;

  const admin = createAdminClient();
  const dayId = await menuDayId(admin, kitchenId, date, user.id);
  if (!dayId) return;

  const { count } = await admin
    .from("menu_day_dishes")
    .select("id", { count: "exact", head: true })
    .eq("menu_day_id", dayId);

  // A dish already on the day is not an error worth showing: the answer the
  // person wanted is already true.
  await admin
    .from("menu_day_dishes")
    .insert({ menu_day_id: dayId, dish_id: dishId, sort_order: count ?? 0 })
    .select("id")
    .maybeSingle();

  await admin.from("menu_days").update({ updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", dayId);
  refresh(date);
}

export async function removeDishFromDay(formData: FormData) {
  await requirePlanner();
  const id = String(formData.get("menu_day_dish_id") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!id) return;

  await createAdminClient().from("menu_day_dishes").delete().eq("id", id);
  refresh(date);
}

export async function setDayCounts(formData: FormData) {
  const user = await requirePlanner();
  const kitchenId = String(formData.get("kitchen_id") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!kitchenId || !date) return;

  const planned = Number(formData.get("planned_thaalis") ?? 0);
  const confirmedRaw = String(formData.get("confirmed_thaalis") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  const admin = createAdminClient();
  const dayId = await menuDayId(admin, kitchenId, date, user.id);
  if (!dayId) return;

  await admin
    .from("menu_days")
    .update({
      planned_thaalis: Number.isFinite(planned) && planned >= 0 ? Math.round(planned) : 0,
      // Kept apart from the planned count on purpose: the difference between
      // the two is what says whether to buy more or less.
      confirmed_thaalis: confirmedRaw === "" ? null : Math.max(0, Math.round(Number(confirmedRaw))),
      notes: notes || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", dayId);

  refresh(date);
}

/**
 * Copy a day's menu onto another day.
 *
 * Any past day, not merely the most recent: menus recur, but not weekly.
 * Dishes already on the target day are kept, and the count is only filled in
 * when the day has none of its own.
 */
export async function copyMenuFromDay(formData: FormData) {
  const user = await requirePlanner();
  const kitchenId = String(formData.get("kitchen_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const sourceId = String(formData.get("source_day_id") ?? "");
  if (!kitchenId || !date || !sourceId) return;

  const admin = createAdminClient();
  const [{ data: source }, { data: sourceDishes }] = await Promise.all([
    admin.from("menu_days").select("planned_thaalis").eq("id", sourceId).maybeSingle(),
    admin.from("menu_day_dishes").select("dish_id, sort_order").eq("menu_day_id", sourceId).order("sort_order"),
  ]);
  if (!source) return;

  const dayId = await menuDayId(admin, kitchenId, date, user.id);
  if (!dayId) return;

  const { data: existing } = await admin.from("menu_day_dishes").select("dish_id").eq("menu_day_id", dayId);
  const already = new Set((existing ?? []).map((d) => d.dish_id as string));
  const rows = (sourceDishes ?? [])
    .filter((d) => !already.has(d.dish_id as string))
    .map((d, i) => ({ menu_day_id: dayId, dish_id: d.dish_id as string, sort_order: already.size + i }));
  if (rows.length > 0) await admin.from("menu_day_dishes").insert(rows);

  const { data: day } = await admin.from("menu_days").select("planned_thaalis").eq("id", dayId).maybeSingle();
  if (day && Number(day.planned_thaalis) === 0) {
    await admin.from("menu_days").update({ planned_thaalis: source.planned_thaalis }).eq("id", dayId);
  }

  refresh(date);
}

/** Two kitchens, named by whoever runs them rather than by this migration. */
export async function renameKitchen(formData: FormData) {
  await requirePlanner();
  const id = String(formData.get("kitchen_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  await createAdminClient().from("kitchens").update({ name }).eq("id", id);
  revalidatePath("/menus");
}

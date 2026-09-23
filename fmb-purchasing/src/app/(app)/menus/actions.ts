"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { isSection } from "@/lib/menu-sections";
import { menuDayBlockers } from "./data";

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

/**
 * What a line of the menu offers, and how many take it (#76).
 *
 * The day's count is only a default: people take part of a thaali, and a dish
 * offered as two boxes is not one box each. Clearing the number puts the line
 * back to assuming everybody takes everything it offers, which is the
 * conservative reading and the one that stops a list going short.
 */
export async function setDishCounts(formData: FormData) {
  await requirePlanner();
  const id = String(formData.get("menu_day_dish_id") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!id) return;

  const offered = Number(formData.get("boxes_offered") ?? 1);
  const expectedRaw = String(formData.get("expected_boxes") ?? "").trim();
  const expected = expectedRaw === "" ? null : Math.round(Number(expectedRaw));

  await createAdminClient()
    .from("menu_day_dishes")
    .update({
      boxes_offered: Number.isFinite(offered) && offered > 0 ? offered : 1,
      expected_boxes: expected != null && Number.isFinite(expected) && expected >= 0 ? expected : null,
    })
    .eq("id", id);

  refresh(date);
}

/**
 * Roti, fruit, anything in a thaali that is bought rather than cooked (#76).
 *
 * How much goes in a thaali is the menu's decision and nobody else's: a day of
 * half a roti is half a roti for everyone who takes one. Only the number of
 * takers varies.
 */
export async function addExtraToDay(formData: FormData) {
  const user = await requirePlanner();
  const kitchenId = String(formData.get("kitchen_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  const perThaali = Number(formData.get("per_thaali") ?? 1);
  if (!kitchenId || !date || !itemId) return;
  if (kind !== "roti" && kind !== "fruit" && kind !== "other") return;
  if (!Number.isFinite(perThaali) || perThaali <= 0) return;

  const admin = createAdminClient();
  const dayId = await menuDayId(admin, kitchenId, date, user.id);
  if (!dayId) return;

  const { count } = await admin
    .from("menu_day_extras")
    .select("id", { count: "exact", head: true })
    .eq("menu_day_id", dayId);

  await admin
    .from("menu_day_extras")
    .upsert(
      { menu_day_id: dayId, kind, item_id: itemId, per_thaali: perThaali, sort_order: count ?? 0, created_by: user.id },
      { onConflict: "menu_day_id,kind,item_id" }
    );

  refresh(date);
}

export async function setExtraCounts(formData: FormData) {
  await requirePlanner();
  const id = String(formData.get("extra_id") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!id) return;

  const perThaali = Number(formData.get("per_thaali") ?? 1);
  const expectedRaw = String(formData.get("expected_count") ?? "").trim();
  const expected = expectedRaw === "" ? null : Math.round(Number(expectedRaw));

  await createAdminClient()
    .from("menu_day_extras")
    .update({
      per_thaali: Number.isFinite(perThaali) && perThaali > 0 ? perThaali : 1,
      expected_count: expected != null && Number.isFinite(expected) && expected >= 0 ? expected : null,
    })
    .eq("id", id);

  refresh(date);
}

export async function removeExtraFromDay(formData: FormData) {
  await requirePlanner();
  const id = String(formData.get("extra_id") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!id) return;

  await createAdminClient().from("menu_day_extras").delete().eq("id", id);
  refresh(date);
}

/**
 * A day planned the way the sheet plans it (#77): the menu typed as text, and
 * under it what to buy, typed straight in.
 */
export async function setMenuText(formData: FormData) {
  const user = await requirePlanner();
  const kitchenId = String(formData.get("kitchen_id") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!kitchenId || !date) return;

  const admin = createAdminClient();
  const dayId = await menuDayId(admin, kitchenId, date, user.id);
  if (!dayId) return;

  const text = String(formData.get("menu_text") ?? "").trim();
  await admin
    .from("menu_days")
    .update({ menu_text: text || null, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("id", dayId);

  refresh(date);
}

export async function addMenuLine(formData: FormData) {
  const user = await requirePlanner();
  const kitchenId = String(formData.get("kitchen_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  const unitId = String(formData.get("unit_id") ?? "");
  const quantity = Number(formData.get("quantity") ?? 0);
  const section = String(formData.get("section") ?? "");
  if (!kitchenId || !date || !itemId || !unitId) return;
  if (!Number.isFinite(quantity) || quantity <= 0) return;

  const admin = createAdminClient();
  const dayId = await menuDayId(admin, kitchenId, date, user.id);
  if (!dayId) return;

  const { count } = await admin
    .from("menu_day_lines")
    .select("id", { count: "exact", head: true })
    .eq("menu_day_id", dayId);

  // Typing the same item twice means correcting it, not adding a second line.
  await admin.from("menu_day_lines").upsert(
    {
      menu_day_id: dayId,
      item_id: itemId,
      quantity,
      unit_id: unitId,
      section: isSection(section) ? section : null,
      sort_order: count ?? 0,
      created_by: user.id,
    },
    { onConflict: "menu_day_id,item_id" }
  );

  refresh(date);
}

export async function setMenuLine(formData: FormData) {
  await requirePlanner();
  const id = String(formData.get("line_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const quantity = Number(formData.get("quantity") ?? 0);
  const unitId = String(formData.get("unit_id") ?? "");
  const section = String(formData.get("section") ?? "");
  if (!id || !Number.isFinite(quantity) || quantity <= 0) return;

  await createAdminClient()
    .from("menu_day_lines")
    .update({
      quantity,
      ...(unitId ? { unit_id: unitId } : {}),
      section: isSection(section) ? section : null,
    })
    .eq("id", id);

  refresh(date);
}

export async function removeMenuLine(formData: FormData) {
  await requirePlanner();
  const id = String(formData.get("line_id") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!id) return;

  await createAdminClient().from("menu_day_lines").delete().eq("id", id);
  refresh(date);
}

/**
 * Delete a day's whole menu in one kitchen: its dishes, roti and fruit, typed
 * lines, counts and notes, and — if it was released — the lists nobody has
 * bought against yet. The other kitchen's day is a separate row and is not
 * touched.
 */
export async function deleteMenuDay(formData: FormData) {
  await requirePlanner();
  const dayId = String(formData.get("menu_day_id") ?? "");
  const date = String(formData.get("date") ?? "");
  const kitchenId = String(formData.get("kitchen_id") ?? "");
  if (!dayId) return;

  const admin = createAdminClient();
  const { bought, allocated } = await menuDayBlockers(admin, dayId);
  if (bought > 0 || allocated > 0) return;

  // Everything hanging off the day cascades with it.
  await admin.from("menu_days").delete().eq("id", dayId);

  refresh(date);
  revalidatePath("/procurement");
  redirect(kitchenId ? `/menus?kitchen=${kitchenId}` : "/menus");
}

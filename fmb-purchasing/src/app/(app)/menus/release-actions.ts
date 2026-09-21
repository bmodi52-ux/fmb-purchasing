"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { costMenuDay } from "@/lib/menu-costing";
import { loadDishes, loadExtras, loadItemPrices, loadMenuLines, loadSections, withDayCounts } from "./data";

/**
 * Releasing a day (#70): the menu stops being a plan and becomes somebody's
 * work.
 *
 * What it needs is worked out once and written down — quantity, price, and
 * the price it was worked out at — rather than derived again later. The
 * prices behind it move and the recipes get corrected; a day that has been
 * bought for should still say what it was bought against.
 *
 * Releasing again recomputes it, which is what to do when the count changes.
 * Anything already ordered or delivered keeps its status, its vendor and its
 * owner: the quantity may move, but the buying that has happened has
 * happened.
 */
export async function releaseDay(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "manage");

  const dayId = String(formData.get("menu_day_id") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!dayId) return;

  const admin = createAdminClient();
  const { data: day } = await admin
    .from("menu_days")
    .select(
      "id, kitchen_id, planned_thaalis, confirmed_thaalis, menu_day_dishes ( dish_id, sort_order, boxes_offered, expected_boxes )"
    )
    .eq("id", dayId)
    .maybeSingle();
  if (!day) return;

  const onDay = [...(day.menu_day_dishes ?? [])].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const dishIds = onDay.map((d) => d.dish_id as string);
  const dishes = withDayCounts(
    await loadDishes(admin, dishIds),
    onDay as { dish_id: string; boxes_offered?: number | string | null; expected_boxes?: number | null }[]
  );
  const [extrasByDay, linesByDay] = await Promise.all([loadExtras(admin, [dayId]), loadMenuLines(admin, [dayId])]);
  const extras = extrasByDay.get(dayId) ?? [];
  const lines = linesByDay.get(dayId) ?? [];
  const thaalis = Number(day.confirmed_thaalis ?? day.planned_thaalis);
  // Roti alone is a day worth releasing, and so is a day nobody costed: a
  // typed list still has to be bought.
  if (dishes.length === 0 && extras.length === 0 && lines.length === 0) return;
  if (thaalis <= 0 && lines.length === 0) return;

  const itemIds = [
    ...new Set([
      ...dishes.flatMap((d) => d.ingredients.map((i) => i.itemId)),
      ...extras.map((e) => e.itemId),
      ...lines.map((l) => l.itemId),
    ]),
  ];
  const [prices, sections] = await Promise.all([loadItemPrices(admin, itemIds), loadSections(admin, itemIds)]);
  const cost = costMenuDay({ dishes, extras, lines }, thaalis, prices);

  // Who buys each section: the kitchen's own owner, else the one set for
  // both kitchens.
  const { data: owners } = await admin
    .from("menu_section_owners")
    .select("kitchen_id, section, owner_id")
    .or(`kitchen_id.eq.${day.kitchen_id},kitchen_id.is.null`);
  const ownerFor = (section: string) =>
    (owners ?? []).find((o) => o.section === section && o.kitchen_id === day.kitchen_id)?.owner_id ??
    (owners ?? []).find((o) => o.section === section && o.kitchen_id === null)?.owner_id ??
    null;

  // The cheapest this was bought for lately is the vendor to try first; the
  // person buying can change it.
  const { data: cheapVendors } = await admin
    .from("offer_unit_costs")
    .select("item_id, vendor_id, cost_per_base_unit")
    .in("item_id", itemIds)
    .order("cost_per_base_unit");
  const vendorFor = new Map<string, string>();
  for (const row of cheapVendors ?? []) {
    const itemId = row.item_id as string;
    if (!vendorFor.has(itemId) && row.vendor_id) vendorFor.set(itemId, row.vendor_id as string);
  }

  const { data: existing } = await admin
    .from("menu_requirements")
    .select("id, item_id, status, owner_id, vendor_id")
    .eq("menu_day_id", dayId);
  const before = new Map((existing ?? []).map((r) => [r.item_id as string, r]));

  // The menu is better evidence than a category name: an item put on the day
  // as its roti is the roti, whatever aisle it is filed under. Roti buys on a
  // list of its own, with its own person; fruit does not, because fruit is
  // bought with the rest of the produce even when the menu names it apart.
  const rotiItems = new Set(extras.filter((e) => e.kind === "roti").map((e) => e.itemId));
  // A line typed under a heading belongs under that heading; somebody put it
  // there on purpose.
  const typedSections = new Map(lines.flatMap((l) => (l.section ? [[l.itemId, l.section] as const] : [])));
  const sectionOf = (itemId: string) =>
    rotiItems.has(itemId) ? "roti" : (typedSections.get(itemId) ?? sections.get(itemId) ?? "dry");

  const rows = cost.lines.map((line) => {
    const kept = before.get(line.itemId);
    return {
      menu_day_id: dayId,
      item_id: line.itemId,
      section: sectionOf(line.itemId),
      quantity: line.quantity,
      base_unit_code: line.baseUnitCode,
      price_per_unit: line.perUnit,
      price_basis: line.basis,
      planned_cost: line.cost,
      // Buying that has already happened survives a re-release.
      owner_id: kept?.owner_id ?? ownerFor(sectionOf(line.itemId)),
      vendor_id: kept?.vendor_id ?? vendorFor.get(line.itemId) ?? null,
      status: kept?.status ?? "to_order",
    };
  });

  // Anything no longer needed goes, unless somebody has already bought it —
  // that is a fact about the world, not a line on a plan.
  const keepIds = new Set(rows.map((r) => r.item_id));
  const droppable = (existing ?? []).filter((r) => !keepIds.has(r.item_id as string) && r.status === "to_order");
  if (droppable.length > 0) {
    await admin
      .from("menu_requirements")
      .delete()
      .in("id", droppable.map((r) => r.id as string));
  }

  await admin.from("menu_requirements").upsert(rows, { onConflict: "menu_day_id,item_id" });
  await admin
    .from("menu_days")
    .update({
      status: "released",
      released_at: new Date().toISOString(),
      released_by: user.id,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", dayId);

  revalidatePath(`/menus/${date}`);
  revalidatePath("/menus");
  revalidatePath("/procurement");
}

/** Back to a plan: the day can be edited again, and what nobody has bought goes. */
export async function unreleaseDay(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "manage");

  const dayId = String(formData.get("menu_day_id") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!dayId) return;

  const admin = createAdminClient();
  await admin.from("menu_requirements").delete().eq("menu_day_id", dayId).eq("status", "to_order");
  await admin
    .from("menu_days")
    .update({ status: "draft", released_at: null, released_by: null, updated_by: user.id })
    .eq("id", dayId);

  revalidatePath(`/menus/${date}`);
  revalidatePath("/menus");
  revalidatePath("/procurement");
}

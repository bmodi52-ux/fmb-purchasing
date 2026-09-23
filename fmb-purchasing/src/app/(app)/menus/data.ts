import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting } from "@/lib/app-settings";
import { loadCheapestRecent } from "@/lib/price-alerts-data";
import { todayIso } from "@/lib/periods-data";
import type { ItemPrices, MenuDish, MenuExtra, MenuLine } from "@/lib/menu-costing";
import { resolveSection, type SectionKey } from "@/lib/menu-sections";

/**
 * What the menu pages read: the dishes on a day with their recipes, and the
 * three prices a requirement can be costed at (#70).
 */

export type Kitchen = { id: string; name: string };

export async function loadKitchens(admin: SupabaseClient): Promise<Kitchen[]> {
  const { data } = await admin.from("kitchens").select("id, name").eq("active", true).order("sort_order");
  return (data ?? []).map((k) => ({ id: k.id as string, name: k.name as string }));
}

/** The box sizes on offer, largest first. Empty until somebody adds one. */
export async function loadBoxSizes(admin: SupabaseClient): Promise<number[]> {
  const { data } = await admin.from("box_sizes").select("ml").eq("active", true).order("ml", { ascending: false });
  return (data ?? []).map((row) => Number(row.ml));
}

type DishRow = {
  id: string;
  name: string;
  recipe_basis: "batch" | "box";
  batch_boxes: number | null;
  portion_ml: number;
};

/** Every dish named, with its recipe converted into what the costing takes. */
export async function loadDishes(admin: SupabaseClient, dishIds: string[]): Promise<MenuDish[]> {
  if (dishIds.length === 0) return [];

  const [{ data: dishes }, { data: ingredients }] = await Promise.all([
    admin.from("dishes").select("id, name, recipe_basis, batch_boxes, portion_ml").in("id", dishIds),
    admin
      .from("dish_ingredients")
      .select("dish_id, item_id, quantity, sort_order, items ( name ), units ( code, to_base_factor, base_unit_code )")
      .in("dish_id", dishIds)
      .order("sort_order"),
  ]);

  const byDish = new Map<string, MenuDish>();
  for (const d of (dishes ?? []) as DishRow[]) {
    byDish.set(d.id, {
      dishId: d.id,
      dishName: d.name,
      basis: d.recipe_basis,
      portionMl: d.portion_ml,
      batchBoxes: d.batch_boxes,
      ingredients: [],
    });
  }

  for (const row of ingredients ?? []) {
    const dish = byDish.get(row.dish_id as string);
    const item = one(row.items) as { name: string } | null;
    const unit = one(row.units) as { code: string; to_base_factor: number; base_unit_code: string } | null;
    if (!dish || !item || !unit) continue;
    dish.ingredients.push({
      itemId: row.item_id as string,
      itemName: item.name,
      quantity: Number(row.quantity),
      unitCode: unit.code,
      unitToBase: Number(unit.to_base_factor),
      baseUnitCode: unit.base_unit_code,
    });
  }

  // In the order the days list them, which the caller decides.
  return dishIds.flatMap((id) => byDish.get(id) ?? []);
}

/**
 * The menu's own numbers, laid over the dishes it names (#76).
 *
 * A dish is written once and served on many days; how many boxes of it a
 * given day fills is the day's business, not the dish's. So the recipe comes
 * from one place and the count from the other, and they are put together
 * here rather than in four pages that each need both.
 */
export function withDayCounts(
  dishes: MenuDish[],
  rows: { dish_id: string; boxes_offered?: number | string | null; expected_boxes?: number | null }[]
): MenuDish[] {
  const byDish = new Map(rows.map((r) => [r.dish_id, r]));
  return dishes.map((dish) => {
    const row = byDish.get(dish.dishId);
    if (!row) return dish;
    return {
      ...dish,
      boxesOffered: row.boxes_offered == null ? 1 : Number(row.boxes_offered),
      expectedBoxes: row.expected_boxes ?? null,
    };
  });
}

/**
 * The parts of a day that are not dishes — roti, fruit — keyed by day (#76).
 *
 * They carry no recipe, so what they need is the item itself, in the unit the
 * item is counted in.
 */
export async function loadExtras(admin: SupabaseClient, menuDayIds: string[]): Promise<Map<string, MenuExtra[]>> {
  const byDay = new Map<string, MenuExtra[]>();
  if (menuDayIds.length === 0) return byDay;

  const { data: rows } = await admin
    .from("menu_day_extras")
    .select("id, menu_day_id, kind, item_id, per_thaali, expected_count, sort_order, items ( name, canonical_unit_id )")
    .in("menu_day_id", menuDayIds)
    .order("sort_order");
  if (!rows || rows.length === 0) return byDay;

  const unitIds = [
    ...new Set(
      rows.map((r) => (one(r.items) as { canonical_unit_id?: string } | null)?.canonical_unit_id).filter(Boolean)
    ),
  ] as string[];
  const { data: units } = unitIds.length
    ? await admin.from("units").select("id, code, to_base_factor, base_unit_code").in("id", unitIds)
    : { data: [] };
  const unitById = new Map((units ?? []).map((u) => [u.id as string, u]));

  for (const row of rows) {
    const item = one(row.items) as { name: string; canonical_unit_id: string | null } | null;
    if (!item) continue;
    const unit = item.canonical_unit_id ? unitById.get(item.canonical_unit_id) : undefined;
    const dayId = row.menu_day_id as string;
    byDay.set(dayId, [
      ...(byDay.get(dayId) ?? []),
      {
        extraId: row.id as string,
        kind: row.kind as MenuExtra["kind"],
        itemId: row.item_id as string,
        itemName: item.name,
        perThaali: Number(row.per_thaali),
        expectedCount: row.expected_count == null ? null : Number(row.expected_count),
        // An item with no unit of its own is counted one for one, which is
        // what "a roti" or "a piece of fruit" means anyway.
        unitCode: (unit?.code as string) ?? "ea",
        unitToBase: unit ? Number(unit.to_base_factor) : 1,
        baseUnitCode: (unit?.base_unit_code as string) ?? "ea",
      },
    ]);
  }

  return byDay;
}

/**
 * What a day was told to buy, typed straight in (#77), keyed by day.
 *
 * No recipe, no dish: the quantity is the answer rather than something to
 * work out from a count. The unit is kept as it was written, because "800 g"
 * is how somebody says it and converting it on screen would be answering a
 * question nobody asked.
 */
export async function loadMenuLines(admin: SupabaseClient, menuDayIds: string[]): Promise<Map<string, MenuLine[]>> {
  const byDay = new Map<string, MenuLine[]>();
  if (menuDayIds.length === 0) return byDay;

  const { data: rows } = await admin
    .from("menu_day_lines")
    .select(
      "id, menu_day_id, item_id, quantity, section, note, sort_order, items ( name ), units ( code, to_base_factor, base_unit_code )"
    )
    .in("menu_day_id", menuDayIds)
    .order("sort_order");

  for (const row of rows ?? []) {
    const item = one(row.items) as { name: string } | null;
    const unit = one(row.units) as { code: string; to_base_factor: number; base_unit_code: string } | null;
    if (!item || !unit) continue;
    const dayId = row.menu_day_id as string;
    byDay.set(dayId, [
      ...(byDay.get(dayId) ?? []),
      {
        lineId: row.id as string,
        itemId: row.item_id as string,
        itemName: item.name,
        quantity: Number(row.quantity),
        unitCode: unit.code,
        unitToBase: Number(unit.to_base_factor),
        baseUnitCode: unit.base_unit_code,
        section: (row.section as string | null) ?? null,
      },
    ]);
  }

  return byDay;
}

/**
 * The prices for a set of items: what was last paid per base unit, the
 * cheapest paid lately, and what a vendor quotes. Which of them is used is
 * decided by priceFor, not here.
 */
export async function loadItemPrices(admin: SupabaseClient, itemIds: string[]): Promise<Map<string, ItemPrices>> {
  const prices = new Map<string, ItemPrices>();
  if (itemIds.length === 0) return prices;

  const settings = await getSetting(admin, "price_alerts");
  const [{ data: paid }, cheapest, { data: offers }] = await Promise.all([
    admin.from("item_unit_costs").select("item_id, latest_cost_per_base_unit").in("item_id", itemIds),
    loadCheapestRecent(admin, settings.cheapestRecentDays, todayIso()),
    admin.from("offer_unit_costs").select("item_id, cost_per_base_unit").in("item_id", itemIds),
  ]);

  for (const row of paid ?? []) {
    const value = row.latest_cost_per_base_unit == null ? null : Number(row.latest_cost_per_base_unit);
    prices.set(row.item_id as string, { ...prices.get(row.item_id as string), latestPaid: value });
  }

  for (const itemId of itemIds) {
    const recent = cheapest.get(itemId);
    if (recent) prices.set(itemId, { ...prices.get(itemId), cheapestRecent: recent.costPerUnit });
  }

  // The cheapest live quote, since that is the one anybody would buy at.
  for (const row of offers ?? []) {
    const itemId = row.item_id as string;
    const value = row.cost_per_base_unit == null ? null : Number(row.cost_per_base_unit);
    if (value == null) continue;
    const current = prices.get(itemId);
    if (current?.offer == null || value < current.offer) prices.set(itemId, { ...current, offer: value });
  }

  return prices;
}

/**
 * Which procurement list each item belongs on (#70): what the item says, else
 * its category, else its category's parent, else the category name read.
 */
export async function loadSections(admin: SupabaseClient, itemIds: string[]): Promise<Map<string, SectionKey>> {
  const sections = new Map<string, SectionKey>();
  if (itemIds.length === 0) return sections;

  const [{ data: items }, { data: categories }] = await Promise.all([
    admin.from("items").select("id, category_id, menu_section").in("id", itemIds),
    admin.from("categories").select("id, name, parent_category_id, menu_section"),
  ]);

  const byId = new Map((categories ?? []).map((c) => [c.id as string, c]));
  for (const item of items ?? []) {
    const own = item.category_id ? byId.get(item.category_id as string) : undefined;
    const parent = own?.parent_category_id ? byId.get(own.parent_category_id as string) : undefined;
    sections.set(
      item.id as string,
      resolveSection({
        itemSection: item.menu_section as string | null,
        categorySection: own?.menu_section as string | null,
        parentSection: parent?.menu_section as string | null,
        categoryName: own?.name as string | undefined,
        parentName: parent?.name as string | undefined,
      })
    );
  }
  return sections;
}

/** PostgREST gives an embedded row as an object or a one-element array. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Whether a day's menu can be deleted, and if not, why (#21).
 *
 * A released day hands lists to people, and what they have ordered, had
 * delivered or put a receipt against is a fact about the world rather than a
 * line on a plan — the same rule releasing again and "Back to draft" follow.
 * Deleting the day would take those records with it, so a day with any of
 * them stays; its dishes can still be taken off one by one.
 */
export async function menuDayBlockers(
  admin: SupabaseClient,
  dayId: string
): Promise<{ bought: number; allocated: number }> {
  const { data: requirements } = await admin
    .from("menu_requirements")
    .select("id, status")
    .eq("menu_day_id", dayId);
  const bought = (requirements ?? []).filter((r) => r.status === "ordered" || r.status === "delivered").length;
  const ids = (requirements ?? []).map((r) => r.id as string);
  const { count } = ids.length
    ? await admin
        .from("expense_line_allocations")
        .select("id", { count: "exact", head: true })
        .in("menu_requirement_id", ids)
    : { count: 0 };
  return { bought, allocated: count ?? 0 };
}

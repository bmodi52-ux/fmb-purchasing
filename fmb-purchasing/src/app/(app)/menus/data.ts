import type { SupabaseClient } from "@supabase/supabase-js";
import { getSetting } from "@/lib/app-settings";
import { loadCheapestRecent } from "@/lib/price-alerts-data";
import { todayIso } from "@/lib/periods-data";
import type { ItemPrices, MenuDish } from "@/lib/menu-costing";

/**
 * What the menu pages read: the dishes on a day with their recipes, and the
 * three prices a requirement can be costed at (#70).
 */

export type Kitchen = { id: string; name: string };

export async function loadKitchens(admin: SupabaseClient): Promise<Kitchen[]> {
  const { data } = await admin.from("kitchens").select("id, name").eq("active", true).order("sort_order");
  return (data ?? []).map((k) => ({ id: k.id as string, name: k.name as string }));
}

type DishRow = {
  id: string;
  name: string;
  recipe_basis: "batch" | "thaali";
  batch_thaalis: number | null;
};

/** Every dish named, with its recipe converted into what the costing takes. */
export async function loadDishes(admin: SupabaseClient, dishIds: string[]): Promise<MenuDish[]> {
  if (dishIds.length === 0) return [];

  const [{ data: dishes }, { data: ingredients }] = await Promise.all([
    admin.from("dishes").select("id, name, recipe_basis, batch_thaalis").in("id", dishIds),
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
      batchThaalis: d.batch_thaalis,
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

/** PostgREST gives an embedded row as an object or a one-element array. */
function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

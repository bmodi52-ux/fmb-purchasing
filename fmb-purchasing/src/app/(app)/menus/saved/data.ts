import type { SupabaseClient } from "@supabase/supabase-js";
import { costMenuDay, type MenuDayCost, type MenuDish, type MenuExtra, type MenuLine } from "@/lib/menu-costing";
import { loadDishes, loadExtras, loadItemPrices, loadMenuLines, SAVED_SOURCE, withDayCounts } from "../data";

export type SavedMenu = {
  id: string;
  name: string | null;
  saved: boolean;
  favourite: boolean;
  thaalis: number;
  menuText: string | null;
  notes: string | null;
  updatedAt: string;
  dishes: MenuDish[];
  /** dish id → the saved_menu_dishes row, which remove and the counts act on. */
  dishRowIds: Map<string, string>;
  extras: MenuExtra[];
  lines: MenuLine[];
  cost: MenuDayCost;
};

/**
 * Saved menus with everything on them, costed at their own thaali count
 * (#17). One read of dishes and prices for the lot, as the calendar does.
 */
export async function loadSavedMenus(
  admin: SupabaseClient,
  filter: { ids?: string[]; saved?: boolean }
): Promise<SavedMenu[]> {
  let query = admin
    .from("saved_menus")
    .select(
      "id, name, saved, favourite, thaalis, menu_text, notes, updated_at, saved_menu_dishes ( id, dish_id, sort_order, boxes_offered, expected_boxes )"
    )
    .order("favourite", { ascending: false })
    .order("name")
    .order("updated_at", { ascending: false });
  if (filter.ids) query = query.in("id", filter.ids);
  if (filter.saved != null) query = query.eq("saved", filter.saved);
  const { data: rows } = await query;
  if (!rows || rows.length === 0) return [];

  const ids = rows.map((r) => r.id as string);
  const dishRows = rows.flatMap((r) => r.saved_menu_dishes ?? []);
  const [allDishes, extrasBy, linesBy] = await Promise.all([
    loadDishes(admin, [...new Set(dishRows.map((d) => d.dish_id as string))]),
    loadExtras(admin, ids, SAVED_SOURCE),
    loadMenuLines(admin, ids, SAVED_SOURCE),
  ]);
  const dishById = new Map(allDishes.map((d) => [d.dishId, d]));
  const prices = await loadItemPrices(admin, [
    ...new Set([
      ...allDishes.flatMap((d) => d.ingredients.map((i) => i.itemId)),
      ...[...extrasBy.values()].flat().map((e) => e.itemId),
      ...[...linesBy.values()].flat().map((l) => l.itemId),
    ]),
  ]);

  return rows.map((row) => {
    const id = row.id as string;
    const onMenu = [...(row.saved_menu_dishes ?? [])].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    const dishes = withDayCounts(
      onMenu.flatMap((d) => dishById.get(d.dish_id as string) ?? []),
      onMenu as { dish_id: string; boxes_offered?: number | string | null; expected_boxes?: number | null }[]
    );
    const extras = extrasBy.get(id) ?? [];
    const lines = linesBy.get(id) ?? [];
    const thaalis = Number(row.thaalis ?? 0);
    return {
      id,
      name: (row.name as string | null) ?? null,
      saved: Boolean(row.saved),
      favourite: Boolean(row.favourite),
      thaalis,
      menuText: (row.menu_text as string | null) ?? null,
      notes: (row.notes as string | null) ?? null,
      updatedAt: row.updated_at as string,
      dishes,
      dishRowIds: new Map(onMenu.map((d) => [d.dish_id as string, d.id as string])),
      extras,
      lines,
      cost: costMenuDay({ dishes, extras, lines }, thaalis, prices),
    };
  });
}

/** What a saved menu holds, in a few words, for a list. */
export function describeContents(menu: Pick<SavedMenu, "dishes" | "extras" | "lines" | "menuText">): string {
  if (menu.dishes.length > 0) {
    const extras = menu.extras.map((e) => e.itemName);
    return [...menu.dishes.map((d) => d.dishName), ...extras].join(", ");
  }
  if (menu.menuText) return menu.menuText;
  if (menu.lines.length > 0) return `${menu.lines.length} ${menu.lines.length === 1 ? "item" : "items"} to buy`;
  if (menu.extras.length > 0) return menu.extras.map((e) => e.itemName).join(", ");
  return "Nothing on it yet";
}

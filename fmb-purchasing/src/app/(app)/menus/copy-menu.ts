import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A menu's contents, wherever they are held: a day, or a menu saved apart
 * from any day (#17). The rows are the same shape on both sides, so a menu is
 * copied from a day to a saved menu, from a saved menu to a day, or between
 * two saved menus, by the one function.
 */
export type MenuHolder = { dishes: string; extras: string; lines: string; key: string; id: string };

export const dayHolder = (id: string): MenuHolder => ({
  dishes: "menu_day_dishes",
  extras: "menu_day_extras",
  lines: "menu_day_lines",
  key: "menu_day_id",
  id,
});

export const savedHolder = (id: string): MenuHolder => ({
  dishes: "saved_menu_dishes",
  extras: "saved_menu_extras",
  lines: "saved_menu_lines",
  key: "saved_menu_id",
  id,
});

type Row = Record<string, unknown>;

async function rowsOf(admin: SupabaseClient, table: string, key: string, id: string, columns: string): Promise<Row[]> {
  const { data } = await admin
    .from(table)
    .select(columns as string)
    .eq(key, id)
    .order("sort_order")
    .returns<Row[]>();
  return data ?? [];
}

/** Whether a holder has anything on it at all. */
export async function hasContents(admin: SupabaseClient, holder: MenuHolder): Promise<boolean> {
  const counts = await Promise.all(
    [holder.dishes, holder.extras, holder.lines].map((table) =>
      admin.from(table).select("id", { count: "exact", head: true }).eq(holder.key, holder.id)
    )
  );
  return counts.some(({ count }) => (count ?? 0) > 0);
}

/** Take everything off: dishes, roti and fruit, typed lines. Text and counts are the caller's. */
export async function clearContents(admin: SupabaseClient, holder: MenuHolder): Promise<void> {
  await Promise.all(
    [holder.dishes, holder.extras, holder.lines].map((table) => admin.from(table).delete().eq(holder.key, holder.id))
  );
}

/**
 * Copy the dishes, roti and fruit, and typed lines from one holder to another.
 *
 * Whatever the target already has stays as it is: a dish already on it keeps
 * its own counts, and the same goes for roti and typed lines. Only what is
 * missing is added, after what is there.
 */
export async function copyContents(
  admin: SupabaseClient,
  from: MenuHolder,
  to: MenuHolder,
  userId: string
): Promise<void> {
  // Only a day's rows say who added them.
  const createdBy = to.key === "menu_day_id" ? { created_by: userId } : {};

  const [dishes, extras, lines, haveDishes, haveExtras, haveLines] = await Promise.all([
    rowsOf(admin, from.dishes, from.key, from.id, "dish_id, boxes_offered, expected_boxes"),
    rowsOf(admin, from.extras, from.key, from.id, "kind, item_id, per_thaali, expected_count"),
    rowsOf(admin, from.lines, from.key, from.id, "item_id, quantity, unit_id, section"),
    rowsOf(admin, to.dishes, to.key, to.id, "dish_id"),
    rowsOf(admin, to.extras, to.key, to.id, "kind, item_id"),
    rowsOf(admin, to.lines, to.key, to.id, "item_id"),
  ]);

  const dishTaken = new Set(haveDishes.map((r) => r.dish_id as string));
  const newDishes = dishes
    .filter((r) => !dishTaken.has(r.dish_id as string))
    .map((r, i) => ({
      [to.key]: to.id,
      dish_id: r.dish_id,
      boxes_offered: r.boxes_offered ?? 1,
      expected_boxes: r.expected_boxes ?? null,
      sort_order: haveDishes.length + i,
    }));

  const extraKey = (r: Row) => `${r.kind}:${r.item_id}`;
  const extraTaken = new Set(haveExtras.map(extraKey));
  const newExtras = extras
    .filter((r) => !extraTaken.has(extraKey(r)))
    .map((r, i) => ({
      [to.key]: to.id,
      kind: r.kind,
      item_id: r.item_id,
      per_thaali: r.per_thaali,
      expected_count: r.expected_count ?? null,
      sort_order: haveExtras.length + i,
      ...createdBy,
    }));

  const lineTaken = new Set(haveLines.map((r) => r.item_id as string));
  const newLines = lines
    .filter((r) => !lineTaken.has(r.item_id as string))
    .map((r, i) => ({
      [to.key]: to.id,
      item_id: r.item_id,
      quantity: r.quantity,
      unit_id: r.unit_id,
      section: r.section ?? null,
      sort_order: haveLines.length + i,
      ...createdBy,
    }));

  await Promise.all([
    newDishes.length ? admin.from(to.dishes).insert(newDishes) : null,
    newExtras.length ? admin.from(to.extras).insert(newExtras) : null,
    newLines.length ? admin.from(to.lines).insert(newLines) : null,
  ]);
}

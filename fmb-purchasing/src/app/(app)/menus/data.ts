import type { SupabaseClient } from "@supabase/supabase-js";
import { pickCheapest, type ItemPrices, type MenuDish, type MenuExtra, type MenuLine, type PriceCandidate } from "@/lib/menu-costing";
import { resolveSection, type SectionKey } from "@/lib/menu-sections";

/**
 * What the menu pages read: the dishes on a day with their recipes, and the
 * three prices a requirement can be costed at (#70).
 */

export type Kitchen = { id: string; name: string };

/**
 * Where a menu's roti and typed lines are held: on a day, or on a menu saved
 * apart from any day (#17). The rows are the same shape in both.
 */
export type MenuSource = { extras: string; lines: string; key: string };
export const DAY_SOURCE: MenuSource = { extras: "menu_day_extras", lines: "menu_day_lines", key: "menu_day_id" };
export const SAVED_SOURCE: MenuSource = { extras: "saved_menu_extras", lines: "saved_menu_lines", key: "saved_menu_id" };

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
export async function loadExtras(
  admin: SupabaseClient,
  menuDayIds: string[],
  source: MenuSource = DAY_SOURCE
): Promise<Map<string, MenuExtra[]>> {
  const byDay = new Map<string, MenuExtra[]>();
  if (menuDayIds.length === 0) return byDay;

  const { data: rows } = await admin
    .from(source.extras)
    .select(`id, ${source.key}, kind, item_id, per_thaali, expected_count, sort_order, items ( name, canonical_unit_id )` as string)
    .in(source.key, menuDayIds)
    .order("sort_order")
    .returns<Record<string, unknown>[]>();
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
    const dayId = row[source.key] as string;
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
export async function loadMenuLines(
  admin: SupabaseClient,
  menuDayIds: string[],
  source: MenuSource = DAY_SOURCE
): Promise<Map<string, MenuLine[]>> {
  const byDay = new Map<string, MenuLine[]>();
  if (menuDayIds.length === 0) return byDay;

  const { data: rows } = await admin
    .from(source.lines)
    .select(
      `id, ${source.key}, item_id, quantity, section, sort_order, items ( name ), units ( code, to_base_factor, base_unit_code )` as string
    )
    .in(source.key, menuDayIds)
    .order("sort_order")
    .returns<Record<string, unknown>[]>();

  for (const row of rows ?? []) {
    const item = one(row.items) as { name: string } | null;
    const unit = one(row.units) as { code: string; to_base_factor: number; base_unit_code: string } | null;
    if (!item || !unit) continue;
    const dayId = row[source.key] as string;
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
 * The prices for a set of items (#29): every store's offer, and what was last
 * paid at each store in each brand, reduced to the cheapest — within the
 * item's preferred brand when it has one. Prices never expire; the date is
 * carried so it can be shown. Costing always uses an offer's regular price —
 * a special is for the buying list, not for what a thaali costs.
 */
export async function loadItemPrices(admin: SupabaseClient, itemIds: string[]): Promise<Map<string, ItemPrices>> {
  const prices = new Map<string, ItemPrices>();
  if (itemIds.length === 0) return prices;

  const [{ data: items }, { data: offers }, { data: paid }] = await Promise.all([
    admin.from("items").select("id, preferred_brand").in("id", itemIds),
    admin
      .from("offer_unit_costs")
      .select("offer_id, item_id, vendor_id, status, cost_per_base_unit")
      .in("item_id", itemIds)
      .neq("status", "rejected"),
    admin
      .from("item_paid_unit_costs")
      .select("item_id, vendor_id, line_item_id, receipt_date, submitted_at, expense_status, cost_per_base_unit, pack_disagrees")
      .in("item_id", itemIds),
  ]);

  // A cost from a receipt whose pack size disagrees with the Pricelist is
  // not a price anybody paid per kg; declined and withdrawn spend never was.
  const paidRows = (paid ?? []).filter(
    (p) =>
      p.cost_per_base_unit != null &&
      !p.pack_disagrees &&
      p.expense_status !== "declined" &&
      p.expense_status !== "withdrawn"
  );

  // Brand, date and store names for both.
  const lineIds = paidRows.map((p) => p.line_item_id as string);
  const { data: lines } = lineIds.length
    ? await admin.from("expense_line_items").select("id, pricelist_item_id").in("id", lineIds)
    : { data: [] };
  const offerOfLine = new Map((lines ?? []).map((l) => [l.id as string, l.pricelist_item_id as string | null]));
  const offerIds = [
    ...new Set([
      ...(offers ?? []).map((o) => o.offer_id as string),
      ...[...offerOfLine.values()].filter((id): id is string => !!id),
    ]),
  ];
  const vendorIds = [
    ...new Set([...(offers ?? []), ...paidRows].map((r) => r.vendor_id as string | null).filter((id): id is string => !!id)),
  ];
  const [{ data: offerRows }, { data: vendors }] = await Promise.all([
    offerIds.length
      ? admin.from("pricelist_items").select("id, brand, price_read_at, updated_at, created_at").in("id", offerIds)
      : Promise.resolve({ data: [] }),
    vendorIds.length ? admin.from("vendors").select("id, name").in("id", vendorIds) : Promise.resolve({ data: [] }),
  ]);
  const offerById = new Map((offerRows ?? []).map((o) => [o.id as string, o]));
  const vendorName = new Map((vendors ?? []).map((v) => [v.id as string, v.name as string]));
  const day = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 10) : null);

  const candidates = new Map<string, PriceCandidate[]>();
  const add = (itemId: string, c: PriceCandidate) => candidates.set(itemId, [...(candidates.get(itemId) ?? []), c]);

  for (const o of offers ?? []) {
    const row = offerById.get(o.offer_id as string);
    add(o.item_id as string, {
      perUnit: Number(o.cost_per_base_unit),
      source: "quoted",
      vendorName: vendorName.get(o.vendor_id as string) ?? null,
      date: day(row?.price_read_at ?? row?.updated_at ?? row?.created_at),
      brand: (row?.brand as string | null) ?? null,
    });
  }

  // What was last paid at each store, in each brand: the latest receipt, not
  // every one — an old price at a store that has since gone up isn't on offer.
  const latestPaid = new Map<string, (typeof paidRows)[number] & { brand: string | null }>();
  for (const p of paidRows) {
    const offerId = offerOfLine.get(p.line_item_id as string);
    const brand = offerId ? ((offerById.get(offerId)?.brand as string | null) ?? null) : null;
    const key = `${p.item_id}|${p.vendor_id}|${(brand ?? "").toLowerCase()}`;
    const when = String(p.receipt_date ?? p.submitted_at ?? "");
    const current = latestPaid.get(key);
    if (!current || when > String(current.receipt_date ?? current.submitted_at ?? "")) latestPaid.set(key, { ...p, brand });
  }
  for (const p of latestPaid.values()) {
    add(p.item_id as string, {
      perUnit: Number(p.cost_per_base_unit),
      source: "paid",
      vendorName: vendorName.get(p.vendor_id as string) ?? null,
      date: day(p.receipt_date ?? p.submitted_at),
      brand: p.brand,
    });
  }

  const preferred = new Map((items ?? []).map((i) => [i.id as string, (i.preferred_brand as string | null) ?? null]));
  for (const itemId of itemIds) {
    const cheapest = pickCheapest(candidates.get(itemId) ?? [], preferred.get(itemId) ?? null);
    if (cheapest) prices.set(itemId, { cheapest });
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

/**
 * Which dates already have a menu, and in which kitchens (#20) — so picking
 * days to put a menu on shows the ones that would be affected. A day row with
 * nothing on it (a count saved, nothing planned) doesn't count.
 */
export async function loadPlannedDates(
  admin: SupabaseClient,
  from: string,
  to: string
): Promise<Record<string, string[]>> {
  const { data } = await admin
    .from("menu_days")
    .select(
      "service_date, menu_text, kitchens ( name ), menu_day_dishes ( count ), menu_day_extras ( count ), menu_day_lines ( count )"
    )
    .gte("service_date", from)
    .lte("service_date", to)
    .returns<Record<string, unknown>[]>();

  const count = (v: unknown) => Number((one(v as { count: number }[]) as { count: number } | null)?.count ?? 0);
  const planned: Record<string, string[]> = {};
  for (const row of data ?? []) {
    const has =
      Boolean(row.menu_text) ||
      count(row.menu_day_dishes) > 0 ||
      count(row.menu_day_extras) > 0 ||
      count(row.menu_day_lines) > 0;
    if (!has) continue;
    const date = row.service_date as string;
    const kitchen = (one(row.kitchens as { name: string }[]) as { name: string } | null)?.name ?? "";
    planned[date] = [...(planned[date] ?? []), kitchen];
  }
  return planned;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalUnitCode } from "@/lib/units";

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Match the extracted/typed vendor against the Vendors table (§3.1.1).
 * ABN is the strongest signal when present; otherwise falls back to a
 * case-insensitive exact name match. No match -> new provisional vendor.
 */
export async function matchOrCreateVendor(
  admin: SupabaseClient,
  { name, abn, userId }: { name: string; abn: string | null; userId: string }
): Promise<{ id: string; status: "matched" | "created" }> {
  const cleanAbn = abn?.replace(/\D/g, "") || null;

  if (cleanAbn) {
    const { data } = await admin.from("vendors").select("id").eq("abn", cleanAbn).maybeSingle();
    if (data) return { id: data.id, status: "matched" };
  }

  const { data: byName } = await admin
    .from("vendors")
    .select("id")
    .ilike("name", normalize(name))
    .maybeSingle();
  if (byName) return { id: byName.id, status: "matched" };

  const { data: created, error } = await admin
    .from("vendors")
    .insert({ name: name.trim(), abn: cleanAbn, status: "pending", created_by: userId })
    .select("id")
    .single();
  if (error) throw error;
  return { id: created.id, status: "created" };
}

async function unitIdByCode(admin: SupabaseClient, code: string): Promise<string | null> {
  const { data } = await admin.from("units").select("id").eq("code", code).maybeSingle();
  return data?.id ?? null;
}

/**
 * A quantity in a mass or volume unit is already expressed in the terms we
 * cost by, so "80 kg purchased" needs nothing further from a human. A count
 * ("12") is ambiguous — twelve eggs or twelve trays of thirty? — and only the
 * Pricelist reviewer can say, so those packs stay unconfirmed.
 */
async function isSelfEvidentQuantity(admin: SupabaseClient, unitId: string): Promise<boolean> {
  const { data } = await admin.from("units").select("dimension").eq("id", unitId).maybeSingle();
  return data?.dimension === "mass" || data?.dimension === "volume";
}

/**
 * Resolve receipt-extracted unit text against the existing units picklist.
 * Never creates a unit: doing so previously turned every spelling variant
 * ("kg", "kgs", "kilo") into its own incomparable unit, which broke the
 * per-unit cost comparison the Pricelist exists for. Unrecognised text falls
 * back to the caller's unit instead.
 */
async function resolveUnitId(
  admin: SupabaseClient,
  raw: string | null,
  fallbackUnitId: string | null
): Promise<string | null> {
  const canonical = canonicalUnitCode(raw);
  if (canonical) {
    const id = await unitIdByCode(admin, canonical);
    if (id) return id;
  }

  // an admin may have added a bespoke unit (e.g. "bunch") — match that directly
  const trimmed = (raw ?? "").trim();
  if (trimmed) {
    const { data } = await admin.from("units").select("id").ilike("code", trimmed).maybeSingle();
    if (data) return data.id;
  }

  return fallbackUnitId;
}

/**
 * Match/create the top-level Item — one row per canonical product (e.g.
 * "Chicken Thighs", canonical unit kg), independent of vendor or packaging.
 *
 * Scoped by category, matching the unique (category_id, name) constraint from
 * 0009: different meats have different cuts, so "Legs and Shoulders" under
 * Mutton and under Beef are different products and must not collapse into one.
 *
 * Still exact-normalized-name within a category — OCR variants of the same
 * product ("Mutton Legs/Shoulders" vs "Legs and Shoulders") will each create
 * an item, and a merge tool remains deferred (§9/§14).
 */
export async function matchOrCreateItem(
  admin: SupabaseClient,
  {
    description,
    categoryId,
    normalizedUnit,
    userId,
  }: {
    description: string;
    categoryId: string | null;
    normalizedUnit: string | null;
    userId: string;
  }
): Promise<{ id: string; status: "matched" | "created" }> {
  const name = normalize(description);

  const lookup = admin.from("items").select("id").ilike("name", name);
  const { data: existing } = await (categoryId
    ? lookup.eq("category_id", categoryId)
    : lookup.is("category_id", null)
  ).maybeSingle();
  if (existing) return { id: existing.id, status: "matched" };

  const fallbackUnitId = await unitIdByCode(admin, "ea");
  const canonicalUnitId = await resolveUnitId(admin, normalizedUnit, fallbackUnitId);
  if (!canonicalUnitId) throw new Error("No units are configured — seed the units picklist first.");

  const { data: created, error } = await admin
    .from("items")
    .insert({
      name: description.trim(),
      canonical_unit_id: canonicalUnitId,
      category_id: categoryId,
      status: "pending",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: created.id, status: "created" };
}

/**
 * Match/create the pack size an offer is sold in, nested under an Item.
 *
 * Always the plain "one unit" shape. A receipt line tells us how much was
 * bought, not how the vendor packages it — reading "80 kg purchased" as an
 * "80 kg pack size" is what produced nonsense pack sizes previously. The
 * quantity bought lives on the expense line item, where it drives
 * item_paid_unit_costs; real pack shapes (1 L x 10 and the like) are entered
 * by a human on the item page.
 *
 * Weight and volume packs are marked confirmed straight away since the
 * receipt quantity is already in costing terms. Countable ones are left
 * unconfirmed: "12 @ $60" could be twelve eggs or twelve trays of thirty, and
 * until someone says which, any per-unit figure derived from it is a guess.
 */
async function matchOrCreatePackSize(
  admin: SupabaseClient,
  {
    itemId,
    canonicalUnitId,
    normalizedUnit,
  }: {
    itemId: string;
    canonicalUnitId: string;
    normalizedUnit: string | null;
  }
): Promise<string> {
  const innerUnitId = (await resolveUnitId(admin, normalizedUnit, canonicalUnitId)) ?? canonicalUnitId;

  const { data: existing } = await admin
    .from("item_pack_sizes")
    .select("id")
    .eq("item_id", itemId)
    .eq("inner_quantity", 1)
    .eq("inner_unit_id", innerUnitId)
    .eq("pack_count", 1)
    .is("label", null)
    .maybeSingle();
  if (existing) return existing.id;

  const selfEvident = await isSelfEvidentQuantity(admin, innerUnitId);

  const { data: created, error } = await admin
    .from("item_pack_sizes")
    .insert({
      item_id: itemId,
      inner_quantity: 1,
      inner_unit_id: innerUnitId,
      pack_count: 1,
      sold_loose: selfEvident,
      contents_confirmed: selfEvident,
    })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

/**
 * Match a line item against that vendor's known offers for the matched pack
 * size (§3.1.2 — scoped to vendor, never across vendors). No match -> new
 * provisional offer under a matched/created Item + pack size.
 */
export async function matchOrCreateOffer(
  admin: SupabaseClient,
  {
    vendorId,
    description,
    categoryId,
    userId,
    normalizedUnit = null,
  }: {
    vendorId: string;
    description: string;
    categoryId: string | null;
    userId: string;
    normalizedUnit?: string | null;
  }
): Promise<{ id: string; status: "matched" | "created" }> {
  const item = await matchOrCreateItem(admin, { description, categoryId, normalizedUnit, userId });

  const { data: itemRow } = await admin.from("items").select("canonical_unit_id").eq("id", item.id).single();
  const packSizeId = await matchOrCreatePackSize(admin, {
    itemId: item.id,
    canonicalUnitId: itemRow!.canonical_unit_id,
    normalizedUnit,
  });

  const { data: byVendor } = await admin
    .from("pricelist_items")
    .select("id")
    .eq("vendor_id", vendorId)
    .eq("pack_size_id", packSizeId)
    .maybeSingle();
  if (byVendor) return { id: byVendor.id, status: "matched" };

  const { data: created, error } = await admin
    .from("pricelist_items")
    .insert({
      vendor_id: vendorId,
      pack_size_id: packSizeId,
      status: "pending",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { id: created.id, status: "created" };
}

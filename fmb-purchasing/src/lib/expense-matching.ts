import type { SupabaseClient } from "@supabase/supabase-js";

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

async function resolveOrCreateUnitId(admin: SupabaseClient, code: string | null): Promise<string> {
  const raw = (code ?? "").trim() || "unit";
  const { data: existing } = await admin.from("units").select("id").ilike("code", raw).maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await admin.from("units").insert({ code: raw, label: raw }).select("id").single();
  if (error) throw error;
  return created.id;
}

/**
 * Match/create the top-level Item — one row per canonical product (e.g.
 * "Chicken Breast", canonical unit kg), independent of vendor or packaging.
 * v1 groups by exact normalized name, same simplification as the
 * canonical-group matching this replaces; a proper mis-grouping merge tool
 * is explicitly deferred (§9/§14).
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

  const { data: existing } = await admin.from("items").select("id").ilike("name", name).maybeSingle();
  if (existing) return { id: existing.id, status: "matched" };

  const canonicalUnitId = await resolveOrCreateUnitId(admin, normalizedUnit);

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
 * Uses the AI-normalized quantity/unit from the receipt line as the pack
 * size when available (e.g. "10 kg" purchased -> a 10 kg pack size);
 * otherwise defaults to "1 x canonical unit".
 */
async function matchOrCreatePackSize(
  admin: SupabaseClient,
  {
    itemId,
    canonicalUnitId,
    normalizedQuantity,
    normalizedUnit,
  }: {
    itemId: string;
    canonicalUnitId: string;
    normalizedQuantity: number | null;
    normalizedUnit: string | null;
  }
): Promise<string> {
  const packSize = normalizedQuantity && normalizedQuantity > 0 ? normalizedQuantity : 1;
  const packSizeUnitId = normalizedUnit ? await resolveOrCreateUnitId(admin, normalizedUnit) : canonicalUnitId;

  const { data: existing } = await admin
    .from("item_pack_sizes")
    .select("id")
    .eq("item_id", itemId)
    .eq("pack_size", packSize)
    .eq("pack_size_unit_id", packSizeUnitId)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await admin
    .from("item_pack_sizes")
    .insert({ item_id: itemId, pack_size: packSize, pack_size_unit_id: packSizeUnitId })
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
    normalizedQuantity = null,
    normalizedUnit = null,
  }: {
    vendorId: string;
    description: string;
    categoryId: string | null;
    userId: string;
    normalizedQuantity?: number | null;
    normalizedUnit?: string | null;
  }
): Promise<{ id: string; status: "matched" | "created" }> {
  const item = await matchOrCreateItem(admin, { description, categoryId, normalizedUnit, userId });

  const { data: itemRow } = await admin.from("items").select("canonical_unit_id").eq("id", item.id).single();
  const packSizeId = await matchOrCreatePackSize(admin, {
    itemId: item.id,
    canonicalUnitId: itemRow!.canonical_unit_id,
    normalizedQuantity,
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

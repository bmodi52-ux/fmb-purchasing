"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";

async function requirePricelistEdit() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "pricelist", "edit_master_data");
  return user;
}

function fieldOrNull(formData: FormData, key: string): string | null {
  return String(formData.get(key) ?? "").trim() || null;
}

function numberOrNull(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export type CreateItemState = { error: string | null; success: boolean };

/**
 * Creates the whole hierarchy in one submission — Item, first pack size,
 * first vendor offer — mirroring the Vendor "everything in one popup"
 * pattern. Further pack sizes/offers are added from the item detail page.
 */
export async function createItem(_prev: CreateItemState, formData: FormData): Promise<CreateItemState> {
  const user = await requirePricelistEdit();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Item name is required.", success: false };

  const canonicalUnitId = fieldOrNull(formData, "canonical_unit_id");
  if (!canonicalUnitId) return { error: "Canonical unit is required.", success: false };

  const admin = createAdminClient();
  const categoryId = fieldOrNull(formData, "category_id");

  // Uniqueness is per category (0009) — the same cut name under two different
  // meats is two different products.
  const duplicateLookup = admin.from("items").select("item_number, name").ilike("name", name);
  const { data: existing } = await (categoryId
    ? duplicateLookup.eq("category_id", categoryId)
    : duplicateLookup.is("category_id", null)
  ).maybeSingle();
  if (existing) {
    return {
      error: `This item already exists in that category: ${existing.item_number} — ${existing.name}. Open it to add a pack size or vendor offer instead.`,
      success: false,
    };
  }

  const { data: item, error: itemError } = await admin
    .from("items")
    .insert({
      name,
      category_id: categoryId,
      canonical_unit_id: canonicalUnitId,
      status: "approved",
      created_by: user.id,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (itemError || !item) return { error: itemError?.message ?? "Could not create the item.", success: false };

  const { data: packSizeRow, error: packSizeError } = await admin
    .from("item_pack_sizes")
    .insert({
      item_id: item.id,
      inner_quantity: numberOrNull(formData, "inner_quantity") ?? 1,
      inner_unit_id: fieldOrNull(formData, "inner_unit_id") ?? canonicalUnitId,
      pack_count: numberOrNull(formData, "pack_count") ?? 1,
      label: fieldOrNull(formData, "pack_label"),
      created_by: user.id,
    })
    .select("id")
    .single();
  if (packSizeError || !packSizeRow) {
    return { error: packSizeError?.message ?? "Could not create the pack size.", success: false };
  }

  const { error: offerError } = await admin.from("pricelist_items").insert({
    pack_size_id: packSizeRow.id,
    vendor_id: fieldOrNull(formData, "vendor_id"),
    brand: fieldOrNull(formData, "brand"),
    vendor_sku: fieldOrNull(formData, "vendor_sku"),
    pack_price: numberOrNull(formData, "pack_price"),
    comments: fieldOrNull(formData, "comments"),
    status: "approved",
    created_by: user.id,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
    updated_by: user.id,
  });
  if (offerError) return { error: offerError.message, success: false };

  revalidatePath("/pricelist");
  return { error: null, success: true };
}

export async function addPackSize(formData: FormData) {
  const user = await requirePricelistEdit();

  const itemId = String(formData.get("item_id") ?? "");
  const innerQuantity = numberOrNull(formData, "inner_quantity");
  const innerUnitId = fieldOrNull(formData, "inner_unit_id");
  if (!itemId || innerQuantity == null || !innerUnitId) return;

  const admin = createAdminClient();
  await admin.from("item_pack_sizes").insert({
    item_id: itemId,
    inner_quantity: innerQuantity,
    inner_unit_id: innerUnitId,
    pack_count: numberOrNull(formData, "pack_count") ?? 1,
    label: fieldOrNull(formData, "label"),
    created_by: user.id,
  });

  revalidatePath(`/pricelist/${itemId}`);
}

export async function removePackSize(formData: FormData) {
  await requirePricelistEdit();
  const packSizeId = String(formData.get("pack_size_id") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  if (!packSizeId) return;

  const admin = createAdminClient();
  const { count } = await admin
    .from("pricelist_items")
    .select("id", { count: "exact", head: true })
    .eq("pack_size_id", packSizeId);
  if (count && count > 0) return; // has vendor offers — remove those first

  await admin.from("item_pack_sizes").delete().eq("id", packSizeId);
  revalidatePath(`/pricelist/${itemId}`);
}

export async function addOffer(formData: FormData) {
  const user = await requirePricelistEdit();

  const itemId = String(formData.get("item_id") ?? "");
  const packSizeId = String(formData.get("pack_size_id") ?? "");
  if (!itemId || !packSizeId) return;

  const admin = createAdminClient();
  await admin.from("pricelist_items").insert({
    pack_size_id: packSizeId,
    vendor_id: fieldOrNull(formData, "vendor_id"),
    brand: fieldOrNull(formData, "brand"),
    vendor_sku: fieldOrNull(formData, "vendor_sku"),
    pack_price: numberOrNull(formData, "pack_price"),
    comments: fieldOrNull(formData, "comments"),
    status: "approved",
    created_by: user.id,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
    updated_by: user.id,
  });

  revalidatePath(`/pricelist/${itemId}`);
  revalidatePath("/pricelist");
}

async function reviewOffers(offerIds: string[], decision: "approved" | "rejected") {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "pricelist", "approve_master_data");
  if (offerIds.length === 0) return;

  const admin = createAdminClient();
  await admin
    .from("pricelist_items")
    .update({ status: decision, reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .in("id", offerIds);

  if (decision === "approved") {
    const { data: offers } = await admin
      .from("pricelist_items")
      .select("pack_size_id, item_pack_sizes(item_id)")
      .in("id", offerIds)
      .returns<{ pack_size_id: string; item_pack_sizes: { item_id: string } | null }[]>();
    const itemIds = [...new Set((offers ?? []).map((o) => o.item_pack_sizes?.item_id).filter(Boolean) as string[])];
    if (itemIds.length > 0) {
      await admin
        .from("items")
        .update({ status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .in("id", itemIds)
        .eq("status", "pending");
    }
  }

  revalidatePath("/pricelist");
}

/** Approving an offer also confirms its parent Item, if still pending. */
export async function reviewOffer(formData: FormData) {
  const offerId = String(formData.get("offer_id"));
  const decision = String(formData.get("decision"));
  if (!offerId || (decision !== "approved" && decision !== "rejected")) return;
  await reviewOffers([offerId], decision);
}

export async function bulkReviewOffers(offerIds: string[], decision: "approved" | "rejected") {
  await reviewOffers(offerIds, decision);
}

const ITEM_TRACKED_FIELDS = ["name", "category_id", "canonical_unit_id", "comments"] as const;
type ItemTrackedRow = Record<(typeof ITEM_TRACKED_FIELDS)[number], unknown>;

export async function updateItem(formData: FormData) {
  const user = await requirePricelistEdit();

  const itemId = String(formData.get("item_id"));
  if (!itemId) return;

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("items")
    .select(ITEM_TRACKED_FIELDS.join(", "))
    .eq("id", itemId)
    .single<ItemTrackedRow>();
  if (!before) return;

  const next: ItemTrackedRow = {
    name: String(formData.get("name") ?? "").trim(),
    category_id: fieldOrNull(formData, "category_id"),
    canonical_unit_id: fieldOrNull(formData, "canonical_unit_id"),
    comments: fieldOrNull(formData, "comments"),
  };

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of ITEM_TRACKED_FIELDS) {
    if (String(before[field] ?? "") !== String(next[field] ?? "")) {
      changes[field] = { old: before[field], new: next[field] };
    }
  }

  if (Object.keys(changes).length > 0) {
    await admin
      .from("items")
      .update({ ...next, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq("id", itemId);

    await admin.from("item_history").insert({ item_id: itemId, changed_by: user.id, changes });
  }

  revalidatePath(`/pricelist/${itemId}`);
  revalidatePath("/pricelist");
}

const OFFER_TRACKED_FIELDS = [
  "vendor_id",
  "brand",
  "vendor_sku",
  "pack_size_id",
  "pack_price",
  "comments",
] as const;
type OfferTrackedRow = Record<(typeof OFFER_TRACKED_FIELDS)[number], unknown>;

export async function updateOffer(formData: FormData) {
  const user = await requirePricelistEdit();

  const offerId = String(formData.get("offer_id"));
  const itemId = String(formData.get("item_id"));
  if (!offerId || !itemId) return;

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("pricelist_items")
    .select(OFFER_TRACKED_FIELDS.join(", "))
    .eq("id", offerId)
    .single<OfferTrackedRow>();
  if (!before) return;

  const next: OfferTrackedRow = {
    vendor_id: fieldOrNull(formData, "vendor_id"),
    brand: fieldOrNull(formData, "brand"),
    vendor_sku: fieldOrNull(formData, "vendor_sku"),
    pack_size_id: fieldOrNull(formData, "pack_size_id") ?? String(before.pack_size_id),
    pack_price: numberOrNull(formData, "pack_price"),
    comments: fieldOrNull(formData, "comments"),
  };

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of OFFER_TRACKED_FIELDS) {
    if (String(before[field] ?? "") !== String(next[field] ?? "")) {
      changes[field] = { old: before[field], new: next[field] };
    }
  }

  if (Object.keys(changes).length > 0) {
    await admin
      .from("pricelist_items")
      .update({ ...next, updated_at: new Date().toISOString(), updated_by: user.id })
      .eq("id", offerId);

    await admin.from("pricelist_item_history").insert({ item_id: offerId, changed_by: user.id, changes });
  }

  revalidatePath(`/pricelist/${itemId}`);
  revalidatePath("/pricelist");
}

export async function addUnit(formData: FormData) {
  await requirePricelistEdit();
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return;

  const admin = createAdminClient();
  await admin.from("units").insert({ code, label: code });
  revalidatePath("/pricelist");
}

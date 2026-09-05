"use server";

import { revalidatePath } from "next/cache";
import { revalidateReports } from "../reports/data";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { categoryLabelsById } from "@/lib/categories";
import { recordVendorItemDescription } from "@/lib/expense-matching";
import { itemIdsByRetiredNumber, itemMatchFilter } from "@/lib/item-search";
import { UNIT_DIMENSIONS, type UnitDimension } from "@/lib/units";

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
      sold_loose: formData.get("sold_loose") === "on",
      contents_confirmed: true,
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
  revalidateReports();
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
    sold_loose: formData.get("sold_loose") === "on",
    // entered by a human, so its contents are known by definition
    contents_confirmed: true,
    created_by: user.id,
  });

  revalidatePath(`/pricelist/${itemId}`);
  revalidatePath("/pricelist");
  revalidateReports();
}

const PACK_SIZE_TRACKED_FIELDS = [
  "inner_quantity",
  "inner_unit_id",
  "pack_count",
  "label",
  "sold_loose",
  "contents_confirmed",
] as const;
type PackSizeTrackedRow = Record<(typeof PACK_SIZE_TRACKED_FIELDS)[number], unknown>;

/**
 * Pack sizes previously could not be corrected at all: there was no update
 * action, and removal is refused while an offer is attached (with no way to
 * delete an offer either), so a placeholder created from a receipt was a dead
 * end fixable only in SQL.
 *
 * Editing one changes every derived per-unit cost for the purchases attached
 * to it — that is the point, since it lets a reviewer correct history rather
 * than re-enter it — so the change is written to the item's history.
 */
export async function updatePackSize(formData: FormData) {
  const user = await requirePricelistEdit();

  const packSizeId = String(formData.get("pack_size_id") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  if (!packSizeId || !itemId) return;

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("item_pack_sizes")
    .select(PACK_SIZE_TRACKED_FIELDS.join(", "))
    .eq("id", packSizeId)
    .single<PackSizeTrackedRow>();
  if (!before) return;

  const innerQuantity = numberOrNull(formData, "inner_quantity");
  const innerUnitId = fieldOrNull(formData, "inner_unit_id");
  if (innerQuantity == null || innerQuantity <= 0 || !innerUnitId) return;

  const next: PackSizeTrackedRow = {
    inner_quantity: innerQuantity,
    inner_unit_id: innerUnitId,
    pack_count: numberOrNull(formData, "pack_count") ?? 1,
    label: fieldOrNull(formData, "label"),
    sold_loose: formData.get("sold_loose") === "on",
    // Saving this form *is* the confirmation — a human has just stated what
    // one unit contains.
    contents_confirmed: true,
  };

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of PACK_SIZE_TRACKED_FIELDS) {
    if (String(before[field] ?? "") !== String(next[field] ?? "")) {
      changes[field] = { old: before[field], new: next[field] };
    }
  }

  if (Object.keys(changes).length > 0) {
    const { error } = await admin.from("item_pack_sizes").update(next).eq("id", packSizeId);
    if (error) return;
    await admin.from("item_history").insert({ item_id: itemId, changed_by: user.id, changes });
  }

  revalidatePath(`/pricelist/${itemId}`);
  revalidatePath("/pricelist");
  revalidateReports();
}

/**
 * Removes a vendor offer. Needed so a wrongly auto-created offer can be
 * cleared — it is also what blocks its pack size from being removed.
 * Refused once real expenses reference it, since that would orphan them.
 */
export async function deleteOffer(formData: FormData) {
  await requirePricelistEdit();
  const offerId = String(formData.get("offer_id") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  if (!offerId) return;

  const admin = createAdminClient();
  const { count } = await admin
    .from("expense_line_items")
    .select("id", { count: "exact", head: true })
    .eq("pricelist_item_id", offerId);
  if (count && count > 0) return; // submitted expenses point at it

  await admin.from("pricelist_item_history").delete().eq("item_id", offerId);
  await admin.from("pricelist_items").delete().eq("id", offerId);

  revalidatePath(`/pricelist/${itemId}`);
  revalidatePath("/pricelist");
  revalidateReports();
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
  revalidateReports();
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
  revalidateReports();
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
  revalidateReports();
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

    // Renaming an item used to break matching outright: receipts still say
    // what they said, and the old name was the only thing linking them. Keep
    // it as a description so tidying a name stays free of consequence.
    if (changes.name) {
      await recordVendorItemDescription(admin, {
        itemId,
        vendorId: null,
        description: String(changes.name.old ?? ""),
        userId: user.id,
      });
    }
  }

  revalidatePath(`/pricelist/${itemId}`);
  revalidatePath("/pricelist");
  revalidateReports();
}

/**
 * Teach an item a wording somebody expects to see on a receipt — either
 * ahead of the first one arriving, or to repair a link after a merge.
 */
export async function addVendorItemDescription(formData: FormData) {
  const user = await requirePricelistEdit();

  const itemId = String(formData.get("item_id"));
  const description = String(formData.get("description") ?? "").trim();
  if (!itemId || !description) return;

  await recordVendorItemDescription(createAdminClient(), {
    itemId,
    vendorId: fieldOrNull(formData, "vendor_id"),
    description,
    userId: user.id,
  });

  revalidatePath(`/pricelist/${itemId}`);
}

/**
 * Scoped by item as well as id: a description is only ever removed from the
 * page it is shown on, and the id alone must not be enough to unpick another
 * item's matching.
 */
export async function removeVendorItemDescription(formData: FormData) {
  await requirePricelistEdit();

  const id = String(formData.get("description_id"));
  const itemId = String(formData.get("item_id"));
  if (!id || !itemId) return;

  const admin = createAdminClient();
  await admin.from("vendor_item_descriptions").delete().eq("id", id).eq("item_id", itemId);

  revalidatePath(`/pricelist/${itemId}`);
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
  revalidateReports();
}

export type ItemSearchResult = {
  id: string;
  itemNumber: string | null;
  name: string;
  categoryLabel: string | null;
  packSizeCount: number;
};

/** Item typeahead for choosing what to merge into. Excludes the item itself. */
export async function searchItemsForMerge(query: string, excludeItemId: string): Promise<ItemSearchResult[]> {
  await requirePricelistEdit();

  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const admin = createAdminClient();
  const retiredMatchIds = await itemIdsByRetiredNumber(admin, trimmed);
  const { data: items } = await admin
    .from("items")
    .select("id, item_number, name, category_id")
    .or(itemMatchFilter(trimmed, retiredMatchIds))
    .neq("id", excludeItemId)
    .limit(10);
  if (!items || items.length === 0) return [];

  const [{ data: categories }, { data: packSizes }] = await Promise.all([
    admin.from("categories").select("id, name, parent_category_id"),
    admin.from("item_pack_sizes").select("item_id").in("item_id", items.map((i) => i.id)),
  ]);
  const labels = categoryLabelsById(categories ?? []);
  const packCounts = new Map<string, number>();
  for (const p of packSizes ?? []) packCounts.set(p.item_id, (packCounts.get(p.item_id) ?? 0) + 1);

  return items.map((i) => ({
    id: i.id,
    itemNumber: i.item_number,
    name: i.name,
    categoryLabel: i.category_id ? (labels.get(i.category_id) ?? null) : null,
    packSizeCount: packCounts.get(i.id) ?? 0,
  }));
}

export type MergeItemState = { error: string | null };

/**
 * Folds one item into another. All the repointing happens inside the
 * merge_items() SQL function so a failure can't leave expense line items
 * pointing at a half-deleted item.
 */
export async function mergeItemAction(_prev: MergeItemState, formData: FormData): Promise<MergeItemState> {
  const user = await requirePricelistEdit();

  const loserId = String(formData.get("loser_id") ?? "");
  const winnerId = String(formData.get("winner_id") ?? "");
  if (!loserId || !winnerId) return { error: "Choose an item to merge into." };
  if (loserId === winnerId) return { error: "That's the same item." };

  const admin = createAdminClient();
  const { error } = await admin.rpc("merge_items", {
    p_loser: loserId,
    p_winner: winnerId,
    p_actor: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath("/pricelist");
  revalidatePath(`/pricelist/${winnerId}`);
  revalidateReports();

  // The page this was submitted from no longer exists, so redirect server-side
  // — a client-side redirect loses the race against revalidation re-rendering
  // the deleted item's page into a 404.
  redirect(`/pricelist/${winnerId}`);
}

/** Records that two similarly-named items are genuinely different products. */
export async function dismissDuplicatePair(formData: FormData) {
  const user = await requirePricelistEdit();

  const a = String(formData.get("item_a") ?? "");
  const b = String(formData.get("item_b") ?? "");
  if (!a || !b || a === b) return;

  // stored lower-id-first so the pair is order-free
  const [itemA, itemB] = a < b ? [a, b] : [b, a];

  const admin = createAdminClient();
  await admin
    .from("item_duplicate_dismissals")
    .upsert({ item_a: itemA, item_b: itemB, dismissed_by: user.id }, { onConflict: "item_a,item_b" });

  revalidatePath("/pricelist");
  revalidatePath(`/pricelist/${a}`);
  revalidatePath(`/pricelist/${b}`);
}

export type UnitFormState = { error: string | null; success: boolean };

/**
 * Adding a unit never worked: 0009 made units.base_unit_code NOT NULL with no
 * default, this only sent code and label, and the error was discarded — so the
 * button submitted, failed, and showed nothing.
 *
 * The missing fields are not defaultable. A cost is only comparable with
 * another when both reduce to the same base unit (see offer_unit_costs in
 * 0010, which groups by base_unit_code), so a unit that guessed its dimension
 * and factor would produce exactly the silently-wrong per-unit costs 0009 was
 * written to eliminate. They are asked for instead.
 */
export async function addUnit(_prev: UnitFormState, formData: FormData): Promise<UnitFormState> {
  await requirePricelistEdit();

  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "A unit name is required.", success: false };

  const dimension = String(formData.get("dimension") ?? "").trim();
  if (!UNIT_DIMENSIONS.includes(dimension as UnitDimension)) {
    return { error: "Choose what this unit measures.", success: false };
  }

  const admin = createAdminClient();

  const { data: clash } = await admin.from("units").select("code").eq("code", code).maybeSingle();
  if (clash) return { error: `A unit called "${code}" already exists.`, success: false };

  // Empty means "this unit defines its own scale" — the first unit of a
  // dimension has nothing to convert to, and length currently has none at all.
  const baseChoice = String(formData.get("base_unit_code") ?? "").trim();

  let baseUnitCode = code;
  let toBaseFactor = 1;

  if (baseChoice) {
    const { data: base } = await admin
      .from("units")
      .select("code, dimension, base_unit_code")
      .eq("code", baseChoice)
      .maybeSingle();

    if (!base) return { error: `There is no unit called "${baseChoice}".`, success: false };
    if (base.dimension !== dimension) {
      return { error: `${baseChoice} measures ${base.dimension}, not ${dimension}.`, success: false };
    }
    // Converting to a non-base unit would put this unit one step further from
    // the base than everything else, and the cost views compare on the base.
    if (base.base_unit_code !== base.code) {
      return {
        error: `${baseChoice} is itself measured against ${base.base_unit_code}. Convert to ${base.base_unit_code} directly, so every ${dimension} unit shares one base.`,
        success: false,
      };
    }

    const factor = numberOrNull(formData, "to_base_factor");
    if (factor == null || factor <= 0) {
      return {
        error: `How many ${baseChoice} is one ${code}? Enter a number greater than zero.`,
        success: false,
      };
    }

    baseUnitCode = base.code;
    toBaseFactor = factor;
  }

  const { error } = await admin.from("units").insert({
    code,
    label: code,
    dimension,
    base_unit_code: baseUnitCode,
    to_base_factor: toBaseFactor,
    sort_order: 100,
  });
  if (error) return { error: error.message, success: false };

  revalidatePath("/pricelist/units");
  revalidatePath("/pricelist");
  revalidateReports();
  return { error: null, success: true };
}

// ---------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------

export type CategoryFormState = { error: string | null; success: boolean };

/** Mirrors the categories_code_format check constraint in migration 0024. */
const CATEGORY_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;

/**
 * Codes are the visible half of every item number, so they are normalised
 * rather than rejected on case — someone typing "chk" means CHK.
 */
function categoryCodeOrNull(formData: FormData): { code: string | null; error: string | null } {
  const raw = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!raw) return { code: null, error: null };
  if (!CATEGORY_CODE_PATTERN.test(raw)) {
    return {
      code: null,
      error: "A code is 2–6 characters, letters and digits, starting with a letter (e.g. CHK).",
    };
  }
  return { code: raw, error: null };
}

export async function createCategory(
  _prev: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  await requirePricelistEdit();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "A category name is required.", success: false };

  const { code, error: codeError } = categoryCodeOrNull(formData);
  if (codeError) return { error: codeError, success: false };

  const admin = createAdminClient();
  const { error } = await admin.from("categories").insert({
    name,
    code,
    parent_category_id: fieldOrNull(formData, "parent_category_id"),
    sort_order: numberOrNull(formData, "sort_order") ?? 500,
  });

  if (error) {
    // Both collisions are unique-constraint violations; say which one.
    const message = error.message.includes("categories_code_key")
      ? `The code ${code} is already used by another category.`
      : error.message.includes("categories_name_key")
        ? `A category called "${name}" already exists.`
        : error.message;
    return { error: message, success: false };
  }

  revalidatePath("/pricelist/categories");
  revalidatePath("/pricelist");
  revalidateReports();
  return { error: null, success: true };
}

/**
 * Renaming, re-parenting or recoding a category. Changing the code renumbers
 * every item filed under it — the categories_propagate_code trigger does the
 * work, and the old numbers survive in item_number_aliases.
 */
export async function updateCategory(
  _prev: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  await requirePricelistEdit();

  const id = String(formData.get("category_id") ?? "");
  if (!id) return { error: "No category to update.", success: false };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "A category name is required.", success: false };

  const { code, error: codeError } = categoryCodeOrNull(formData);
  if (codeError) return { error: codeError, success: false };

  const parentCategoryId = fieldOrNull(formData, "parent_category_id");
  // One level of nesting only, per 0008 — a category that is already somebody
  // else's parent cannot itself be filed under a third.
  if (parentCategoryId === id) {
    return { error: "A category cannot be its own parent.", success: false };
  }

  const admin = createAdminClient();

  if (parentCategoryId) {
    const { count } = await admin
      .from("categories")
      .select("id", { count: "exact", head: true })
      .eq("parent_category_id", id);
    if ((count ?? 0) > 0) {
      return {
        error: "This category has subcategories of its own, so it cannot also sit under another.",
        success: false,
      };
    }
  }

  const { error } = await admin
    .from("categories")
    .update({ name, code, parent_category_id: parentCategoryId })
    .eq("id", id);

  if (error) {
    const message = error.message.includes("categories_code_key")
      ? `The code ${code} is already used by another category.`
      : error.message.includes("categories_name_key")
        ? `A category called "${name}" already exists.`
        : error.message;
    return { error: message, success: false };
  }

  revalidatePath("/pricelist/categories");
  revalidatePath("/pricelist");
  revalidatePath("/submit");
  revalidateReports();
  return { error: null, success: true };
}

/**
 * Only ever removes a category nothing points at. Reassigning items would be
 * a bulk edit with real consequences for their numbers, and that belongs on
 * the items themselves, not buried in a delete button.
 */
export async function deleteCategory(
  _prev: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  await requirePricelistEdit();

  const id = String(formData.get("category_id") ?? "");
  if (!id) return { error: "No category to delete.", success: false };

  const admin = createAdminClient();
  const [items, children, lineItems, offers] = await Promise.all([
    admin.from("items").select("id", { count: "exact", head: true }).eq("category_id", id),
    admin.from("categories").select("id", { count: "exact", head: true }).eq("parent_category_id", id),
    admin.from("expense_line_items").select("id", { count: "exact", head: true }).eq("category_id", id),
    admin.from("pricelist_items").select("id", { count: "exact", head: true }).eq("category_id", id),
  ]);

  // Named individually because "still in use" is not actionable on its own —
  // the fix is different for each.
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const blockers: string[] = [];
  if ((items.count ?? 0) > 0) blockers.push(plural(items.count!, "item", "items"));
  if ((children.count ?? 0) > 0) blockers.push(plural(children.count!, "subcategory", "subcategories"));
  if ((lineItems.count ?? 0) > 0) blockers.push(plural(lineItems.count!, "receipt line", "receipt lines"));
  if ((offers.count ?? 0) > 0) blockers.push(plural(offers.count!, "vendor offer", "vendor offers"));

  if (blockers.length > 0) {
    return {
      error: `Still used by ${blockers.join(", ")}. Move those to another category first.`,
      success: false,
    };
  }

  await admin.from("categories").delete().eq("id", id);
  revalidatePath("/pricelist/categories");
  revalidatePath("/pricelist");
  revalidatePath("/submit");
  revalidateReports();
  return { error: null, success: true };
}

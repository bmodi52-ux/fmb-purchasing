"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { getSetting, setSetting } from "@/lib/app-settings";
import { reportError } from "@/lib/errors";

/**
 * Price alert limits, expected prices and preferred vendors (#29, #42). Set
 * by whoever edits the Pricelist — the people who know what chicken should
 * cost — rather than by account admins.
 */

async function requirePricelistEdit() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "pricelist", "edit_master_data");
  return user;
}

/** A positive percentage, a blank for "use the level above", or an error in words. */
function percentFrom(formData: FormData, key: string, label: string): { value: number | null; error?: string } {
  const raw = String(formData.get(key) ?? "").replace("%", "").trim();
  if (!raw) return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1000) return { value: null, error: `${label} must be a percentage above 0, such as 10.` };
  return { value: Math.round(n * 100) / 100 };
}

function moneyFrom(formData: FormData, key: string, label: string): { value: number | null; error?: string } {
  const raw = String(formData.get(key) ?? "").replace(/[$,\s]/g, "").trim();
  if (!raw) return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { value: null, error: `${label} must be an amount in dollars, such as 7.50.` };
  return { value: Math.round(n * 10000) / 10000 };
}

export type ItemBuyingState = { status: "idle" | "saved" | "error"; message?: string };

const BUYING_FIELDS = [
  "preferred_vendor_id",
  "price_rise_percent",
  "price_fall_percent",
  "expected_min_per_unit",
  "expected_max_per_unit",
] as const;

/** Whether two stored values say the same thing — numeric columns come back as "10.00". */
function same(a: unknown, b: unknown): boolean {
  if (a == null || a === "") return b == null || b === "";
  if (b == null || b === "") return false;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) ? na === nb : String(a) === String(b);
}

/** The item's preferred vendor, its own alert limits and its expected price range. */
export async function updateItemBuying(_prev: ItemBuyingState, formData: FormData): Promise<ItemBuyingState> {
  const user = await requirePricelistEdit();
  const itemId = String(formData.get("item_id") ?? "");
  if (!itemId) return { status: "error", message: "No item to update." };

  const rise = percentFrom(formData, "price_rise_percent", "The rise limit");
  const fall = percentFrom(formData, "price_fall_percent", "The fall limit");
  const min = moneyFrom(formData, "expected_min_per_unit", "The lowest expected price");
  const max = moneyFrom(formData, "expected_max_per_unit", "The highest expected price");
  const problem = rise.error ?? fall.error ?? min.error ?? max.error;
  if (problem) return { status: "error", message: problem };
  if (min.value != null && max.value != null && min.value > max.value) {
    return { status: "error", message: "The lowest expected price is above the highest." };
  }

  const admin = createAdminClient();
  const vendorId = String(formData.get("preferred_vendor_id") ?? "") || null;
  if (vendorId) {
    const { data } = await admin.from("vendors").select("id").eq("id", vendorId).maybeSingle();
    if (!data) return { status: "error", message: "That vendor no longer exists." };
  }

  const next = {
    preferred_vendor_id: vendorId,
    price_rise_percent: rise.value,
    price_fall_percent: fall.value,
    expected_min_per_unit: min.value,
    expected_max_per_unit: max.value,
  };

  const { data: before } = await admin.from("items").select(BUYING_FIELDS.join(", ")).eq("id", itemId).maybeSingle();
  if (!before) return { status: "error", message: "That item no longer exists." };
  const previous = before as unknown as Record<(typeof BUYING_FIELDS)[number], unknown>;

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of BUYING_FIELDS) {
    if (!same(previous[field], next[field])) changes[field] = { old: previous[field], new: next[field] };
  }
  if (Object.keys(changes).length === 0) return { status: "saved", message: "Nothing to change." };

  const { error } = await admin
    .from("items")
    .update({ ...next, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq("id", itemId);
  if (error) {
    await reportError({ source: "item-buying", error: error.message, userId: user.id });
    return { status: "error", message: "The changes could not be saved. Try again." };
  }
  await admin.from("item_history").insert({ item_id: itemId, changed_by: user.id, changes });

  revalidatePath(`/pricelist/${itemId}`);
  revalidatePath("/pricelist");
  revalidatePath("/approvals");
  return { status: "saved", message: "Saved." };
}

/** The Pricelist-wide limits and the unusual-spend test. */
export async function setPriceAlertSettings(formData: FormData): Promise<void> {
  const user = await requirePricelistEdit();
  const admin = createAdminClient();
  const current = await getSetting(admin, "price_alerts");

  const whole = (key: string, fallback: number, lo: number, hi: number) => {
    const n = Number(String(formData.get(key) ?? "").replace(/[%×x\s]/g, ""));
    return Number.isFinite(n) && n >= lo && n <= hi ? n : fallback;
  };

  const value = {
    enabled: formData.get("enabled") === "on",
    risePercent: Math.round(whole("rise", current.risePercent, 0.1, 1000) * 100) / 100,
    fallPercent: Math.round(whole("fall", current.fallPercent, 0.1, 1000) * 100) / 100,
    notifyPricelistEditors: formData.get("notify") === "on",
    spendMultiple: Math.round(whole("spend_multiple", current.spendMultiple, 1.1, 100) * 10) / 10,
    spendMinHistory: Math.round(whole("spend_min_history", current.spendMinHistory, 1, 500)),
    cheapestRecentDays: Math.round(whole("cheapest_days", current.cheapestRecentDays, 7, 730)),
  };

  const { error } = await setSetting(admin, "price_alerts", value, user.id);
  if (error) {
    await reportError({ source: "app-settings", error, detail: "price_alerts", userId: user.id });
    throw new Error("The price alert settings could not be saved. Try again.");
  }
  revalidatePath("/pricelist/price-alerts");
  revalidatePath("/pricelist");
  revalidatePath("/approvals");
}

/**
 * One of a category's own limits; blank falls back to the Pricelist's. Only
 * the limit posted is written, so saving a rise can't undo a fall saved a
 * moment before.
 */
export async function setCategoryPriceLimits(formData: FormData): Promise<void> {
  const user = await requirePricelistEdit();
  const categoryId = String(formData.get("category_id") ?? "");
  if (!categoryId) return;
  const update: Record<string, number | null> = {};
  for (const [field, label] of [
    ["price_rise_percent", "The rise limit"],
    ["price_fall_percent", "The fall limit"],
  ] as const) {
    if (!formData.has(field)) continue;
    const parsed = percentFrom(formData, field, label);
    if (parsed.error) throw new Error(parsed.error);
    update[field] = parsed.value;
  }
  if (Object.keys(update).length === 0) return;

  const { error } = await createAdminClient().from("categories").update(update).eq("id", categoryId);
  if (error) {
    await reportError({ source: "category-price-limits", error: error.message, userId: user.id });
    throw new Error("The limit could not be saved. Try again.");
  }
  revalidatePath("/pricelist/price-alerts");
  revalidatePath("/approvals");
}

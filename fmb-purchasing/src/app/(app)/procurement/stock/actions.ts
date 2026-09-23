"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";

/**
 * The monthly stock count (#10). Counting is for whoever buys; which items
 * are counted is for whoever runs procurement.
 */

async function requireCounter() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "procurement", "view");
  return user;
}

async function requireManager() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "procurement", "manage");
  return user;
}

function refresh() {
  revalidatePath("/procurement/stock");
}

/** Every item's count for one date, in one go. A blank leaves that item alone. */
export async function saveStockCount(formData: FormData) {
  const user = await requireCounter();
  const countedOn = String(formData.get("counted_on") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(countedOn)) return;

  const rows = formData
    .getAll("item_id")
    .map(String)
    .flatMap((itemId) => {
      const raw = String(formData.get(`quantity_${itemId}`) ?? "").trim();
      const unitId = String(formData.get(`unit_${itemId}`) ?? "");
      const quantity = Number(raw);
      if (raw === "" || !unitId || !Number.isFinite(quantity) || quantity < 0) return [];
      const note = String(formData.get(`note_${itemId}`) ?? "").trim();
      return [{ counted_on: countedOn, item_id: itemId, quantity, unit_id: unitId, note: note || null, counted_by: user.id }];
    });
  if (rows.length === 0) return;

  // Counting the same item again on the same date corrects it.
  await createAdminClient().from("stock_counts").upsert(rows, { onConflict: "counted_on,item_id" });
  refresh();
  redirect(`/procurement/stock?saved=${rows.length}&date=${countedOn}`);
}

export async function removeStockCount(formData: FormData) {
  await requireManager();
  const id = String(formData.get("count_id") ?? "");
  if (!id) return;
  await createAdminClient().from("stock_counts").delete().eq("id", id);
  refresh();
}

export async function addStockItem(formData: FormData) {
  const user = await requireManager();
  const itemId = String(formData.get("item_id") ?? "");
  if (!itemId) return;

  const admin = createAdminClient();
  const { count } = await admin.from("stock_count_items").select("item_id", { count: "exact", head: true });
  await admin
    .from("stock_count_items")
    .upsert({ item_id: itemId, sort_order: count ?? 0, added_by: user.id }, { onConflict: "item_id", ignoreDuplicates: true });
  refresh();
}

/** Stop counting an item. Its past counts stay. */
export async function removeStockItem(formData: FormData) {
  await requireManager();
  const itemId = String(formData.get("item_id") ?? "");
  if (!itemId) return;
  await createAdminClient().from("stock_count_items").delete().eq("item_id", itemId);
  refresh();
}

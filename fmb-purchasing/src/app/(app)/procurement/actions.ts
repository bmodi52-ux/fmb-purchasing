"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { notify } from "@/lib/notifications-inapp";
import { dayLabel, sectionList } from "@/lib/thaali-buying";
import type { SectionKey } from "@/lib/menu-sections";

/**
 * Buying what a released menu needs (#70).
 *
 * Marking something ordered or delivered is the job of whoever holds it, and
 * of whoever runs procurement; moving it to somebody else is only the
 * latter's. That is the whole permission story here.
 */

async function requireProcurement() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "procurement", "view");
  const permissions = await getUserPermissions(user);
  return { user, canManage: can(permissions, "procurement", "manage") };
}

/** The requirements this person may act on: their own, or anyone's if they run it. */
async function mine(admin: ReturnType<typeof createAdminClient>, ids: string[], userId: string, canManage: boolean) {
  if (canManage) return ids;
  const { data } = await admin.from("menu_requirements").select("id").in("id", ids).eq("owner_id", userId);
  return (data ?? []).map((r) => r.id as string);
}

function refresh() {
  revalidatePath("/procurement");
  revalidatePath("/menus");
}

export async function setRequirementStatus(formData: FormData) {
  const { user, canManage } = await requireProcurement();
  const ids = String(formData.get("requirement_ids") ?? "").split(",").filter(Boolean);
  const status = String(formData.get("status") ?? "");
  if (ids.length === 0 || !["to_order", "ordered", "delivered", "cancelled"].includes(status)) return;

  const admin = createAdminClient();
  const allowed = await mine(admin, ids, user.id, canManage);
  if (allowed.length === 0) return;

  const now = new Date().toISOString();
  await admin
    .from("menu_requirements")
    .update({
      status,
      // Each step keeps its own stamp, so "ordered on Tuesday, came Thursday"
      // survives a later correction.
      ...(status === "ordered" ? { ordered_at: now, ordered_by: user.id } : {}),
      ...(status === "delivered" ? { delivered_at: now, delivered_by: user.id } : {}),
      ...(status === "to_order" ? { ordered_at: null, ordered_by: null, delivered_at: null, delivered_by: null } : {}),
    })
    .in("id", allowed);

  refresh();
}

export async function setRequirementVendor(formData: FormData) {
  const { user, canManage } = await requireProcurement();
  const id = String(formData.get("requirement_id") ?? "");
  const vendorId = String(formData.get("vendor_id") ?? "");
  if (!id) return;

  const admin = createAdminClient();
  const allowed = await mine(admin, [id], user.id, canManage);
  if (allowed.length === 0) return;

  await admin.from("menu_requirements").update({ vendor_id: vendorId || null }).eq("id", id);
  refresh();
}

export async function setRequirementNote(formData: FormData) {
  const { user, canManage } = await requireProcurement();
  const id = String(formData.get("requirement_id") ?? "");
  if (!id) return;

  const admin = createAdminClient();
  const allowed = await mine(admin, [id], user.id, canManage);
  if (allowed.length === 0) return;

  await admin
    .from("menu_requirements")
    .update({ note: String(formData.get("note") ?? "").trim() || null })
    .eq("id", id);
  refresh();
}

/**
 * Hand a whole section of a day, or one stubborn item, to somebody else.
 *
 * Only whoever runs procurement: an assignment somebody can move off
 * themselves is not an assignment.
 */
export async function reassign(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "procurement", "manage");

  const ownerId = String(formData.get("owner_id") ?? "");
  const requirementId = String(formData.get("requirement_id") ?? "");
  const dayId = String(formData.get("menu_day_id") ?? "");
  const section = String(formData.get("section") ?? "");

  const admin = createAdminClient();
  const update = { owner_id: ownerId || null };

  // What is actually changing hands, so the new holder is told about that and
  // not about lines that were already theirs (#15).
  const moving = admin.from("menu_requirements").select("id, section, owner_id, menu_days ( service_date, kitchens ( name ) )");
  const { data: before } = requirementId
    ? await moving.eq("id", requirementId)
    : dayId && section
      ? await moving.eq("menu_day_id", dayId).eq("section", section)
      : { data: [] };

  if (requirementId) {
    await admin.from("menu_requirements").update(update).eq("id", requirementId);
  } else if (dayId && section) {
    await admin.from("menu_requirements").update(update).eq("menu_day_id", dayId).eq("section", section);
  }

  const handed = (before ?? []).filter((r) => r.owner_id !== ownerId);
  if (ownerId && ownerId !== user.id && handed.length > 0) {
    const day = one(handed[0].menu_days) as { service_date: string; kitchens: unknown } | null;
    const kitchen = one(day?.kitchens) as { name: string } | null;
    const date = day?.service_date ?? "";
    await notify(admin, [
      {
        userId: ownerId,
        kind: "thaali_buying",
        title: `Handed to you: ${handed.length} ${handed.length === 1 ? "thing" : "things"} to buy for ${dayLabel(date)}`,
        body: `${kitchen?.name ?? "The kitchen"} · ${sectionList([...new Set(handed.map((r) => r.section as SectionKey))])}`,
        link: `/procurement?from=${date}&to=${date}`,
      },
    ]);
  }

  refresh();
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Who buys each section by default, which is what a release assigns from. */
export async function setSectionOwner(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "procurement", "manage");

  const section = String(formData.get("section") ?? "");
  const ownerId = String(formData.get("owner_id") ?? "");
  const kitchenId = String(formData.get("kitchen_id") ?? "") || null;
  if (!["meat", "produce", "dry"].includes(section)) return;

  const admin = createAdminClient();
  const existing = admin.from("menu_section_owners").select("id").eq("section", section);
  const { data: found } = await (kitchenId ? existing.eq("kitchen_id", kitchenId) : existing.is("kitchen_id", null))
    .maybeSingle();

  if (!ownerId) {
    if (found) await admin.from("menu_section_owners").delete().eq("id", found.id as string);
  } else if (found) {
    await admin.from("menu_section_owners").update({ owner_id: ownerId }).eq("id", found.id as string);
  } else {
    await admin.from("menu_section_owners").insert({ section, owner_id: ownerId, kitchen_id: kitchenId });
  }

  revalidatePath("/procurement/who");
  refresh();
}

/** Which list an item belongs on, when its category gets it wrong (#70). */
export async function setItemSection(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "procurement", "manage");

  const itemId = String(formData.get("item_id") ?? "");
  const section = String(formData.get("menu_section") ?? "");
  if (!itemId) return;

  await createAdminClient()
    .from("items")
    .update({ menu_section: ["meat", "produce", "dry"].includes(section) ? section : null })
    .eq("id", itemId);

  revalidatePath("/procurement/sections");
  refresh();
}

/** The same, for a whole category — which is the usual way to fix Dry goods. */
export async function setCategorySection(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "procurement", "manage");

  const categoryId = String(formData.get("category_id") ?? "");
  const section = String(formData.get("menu_section") ?? "");
  if (!categoryId) return;

  await createAdminClient()
    .from("categories")
    .update({ menu_section: ["meat", "produce", "dry"].includes(section) ? section : null })
    .eq("id", categoryId);

  revalidatePath("/procurement/sections");
  refresh();
}

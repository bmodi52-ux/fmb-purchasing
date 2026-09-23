"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { isSection } from "@/lib/menu-sections";
import {
  cleanDates,
  describeSummary,
  emptySummary,
  needsUnrelease,
  outcomeFor,
  type ExistingDayChoice,
} from "@/lib/menu-apply";
import { loadKitchens, menuDayBlockers } from "../data";
import { clearContents, copyContents, dayHolder, hasContents, savedHolder } from "../copy-menu";
import { logDayChange } from "../day-history";

/**
 * Estimates, saved menus and favourites (#17), and one menu on many days (#20).
 *
 * An estimate is a saved menu nobody has named yet. Everything else here is
 * the day page's editing, pointed at a saved menu instead of a day.
 */

/** Unnamed estimates are for trying things out, and go after a week. */
const ESTIMATE_DAYS = 7;
/** A season of thaali days at most, so a slip of the picker can't write a year. */
const MAX_DAYS = 62;

async function requirePlanner() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "manage");
  return user;
}

function refresh(id: string) {
  revalidatePath("/menus/saved");
  revalidatePath(`/menus/saved/${id}`);
}

function savedId(formData: FormData): string {
  return String(formData.get("saved_menu_id") ?? "");
}

async function touch(admin: ReturnType<typeof createAdminClient>, id: string, userId: string) {
  await admin.from("saved_menus").update({ updated_by: userId, updated_at: new Date().toISOString() }).eq("id", id);
}

/**
 * Start an estimate: empty, from one dish ("what would this dish cost for
 * 250?"), or from a day's menu.
 */
export async function newEstimate(formData: FormData) {
  const user = await requirePlanner();
  const dishId = String(formData.get("dish_id") ?? "");
  const fromDayId = String(formData.get("menu_day_id") ?? "");
  const admin = createAdminClient();

  // Old unnamed estimates are cleared as new ones are started, so there is
  // no job to run and nothing piles up.
  const cutoff = new Date(Date.now() - ESTIMATE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await admin.from("saved_menus").delete().eq("saved", false).lt("updated_at", cutoff);

  let thaalis = 0;
  let menuText: string | null = null;
  if (fromDayId) {
    const { data: day } = await admin
      .from("menu_days")
      .select("planned_thaalis, confirmed_thaalis, menu_text")
      .eq("id", fromDayId)
      .maybeSingle();
    thaalis = Number(day?.confirmed_thaalis ?? day?.planned_thaalis ?? 0);
    menuText = (day?.menu_text as string | null) ?? null;
  }

  const { data: created } = await admin
    .from("saved_menus")
    .insert({ thaalis, menu_text: menuText, created_by: user.id, updated_by: user.id })
    .select("id")
    .single();
  const id = created?.id as string | undefined;
  if (!id) return;

  if (dishId) {
    await admin.from("saved_menu_dishes").insert({ saved_menu_id: id, dish_id: dishId });
  }
  if (fromDayId) {
    await copyContents(admin, dayHolder(fromDayId), savedHolder(id), user.id);
  }

  redirect(`/menus/saved/${id}`);
}

/** Keep an estimate, or rename a saved menu. */
export async function saveMenu(formData: FormData) {
  const user = await requirePlanner();
  const id = savedId(formData);
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  const admin = createAdminClient();
  const favourite = formData.get("favourite");
  await admin
    .from("saved_menus")
    .update({
      name,
      saved: true,
      ...(favourite == null ? {} : { favourite: favourite === "on" || favourite === "true" }),
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  refresh(id);
}

export async function toggleFavourite(formData: FormData) {
  await requirePlanner();
  const id = savedId(formData);
  if (!id) return;

  const admin = createAdminClient();
  const { data: menu } = await admin.from("saved_menus").select("favourite").eq("id", id).maybeSingle();
  if (!menu) return;
  await admin.from("saved_menus").update({ favourite: !menu.favourite }).eq("id", id);
  refresh(id);
}

export async function deleteSavedMenu(formData: FormData) {
  await requirePlanner();
  const id = savedId(formData);
  if (!id) return;

  // Days planned from it were copies, and keep their menus.
  await createAdminClient().from("saved_menus").delete().eq("id", id);
  revalidatePath("/menus/saved");
  redirect("/menus/saved");
}

export async function setSavedCount(formData: FormData) {
  const user = await requirePlanner();
  const id = savedId(formData);
  if (!id) return;

  const thaalis = Number(formData.get("thaalis") ?? 0);
  const notes = String(formData.get("notes") ?? "").trim();
  await createAdminClient()
    .from("saved_menus")
    .update({
      thaalis: Number.isFinite(thaalis) && thaalis >= 0 ? Math.round(thaalis) : 0,
      notes: notes || null,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  refresh(id);
}

export async function addSavedDish(formData: FormData) {
  const user = await requirePlanner();
  const id = savedId(formData);
  const dishId = String(formData.get("dish_id") ?? "");
  if (!id || !dishId) return;

  const admin = createAdminClient();
  const { count } = await admin
    .from("saved_menu_dishes")
    .select("id", { count: "exact", head: true })
    .eq("saved_menu_id", id);
  await admin
    .from("saved_menu_dishes")
    .upsert(
      { saved_menu_id: id, dish_id: dishId, sort_order: count ?? 0 },
      { onConflict: "saved_menu_id,dish_id", ignoreDuplicates: true }
    );
  await touch(admin, id, user.id);
  refresh(id);
}

export async function removeSavedDish(formData: FormData) {
  await requirePlanner();
  const id = savedId(formData);
  const rowId = String(formData.get("saved_menu_dish_id") ?? "");
  if (!id || !rowId) return;

  await createAdminClient().from("saved_menu_dishes").delete().eq("id", rowId).eq("saved_menu_id", id);
  refresh(id);
}

export async function setSavedDishCounts(formData: FormData) {
  await requirePlanner();
  const id = savedId(formData);
  const rowId = String(formData.get("saved_menu_dish_id") ?? "");
  if (!id || !rowId) return;

  const offered = Number(formData.get("boxes_offered") ?? 1);
  const expectedRaw = String(formData.get("expected_boxes") ?? "").trim();
  const expected = expectedRaw === "" ? null : Math.round(Number(expectedRaw));
  await createAdminClient()
    .from("saved_menu_dishes")
    .update({
      boxes_offered: Number.isFinite(offered) && offered > 0 ? offered : 1,
      expected_boxes: expected != null && Number.isFinite(expected) && expected >= 0 ? expected : null,
    })
    .eq("id", rowId)
    .eq("saved_menu_id", id);
  refresh(id);
}

export async function addSavedExtra(formData: FormData) {
  const user = await requirePlanner();
  const id = savedId(formData);
  const kind = String(formData.get("kind") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  const perThaali = Number(formData.get("per_thaali") ?? 1);
  if (!id || !itemId) return;
  if (kind !== "roti" && kind !== "fruit" && kind !== "other") return;
  if (!Number.isFinite(perThaali) || perThaali <= 0) return;

  const admin = createAdminClient();
  const { count } = await admin
    .from("saved_menu_extras")
    .select("id", { count: "exact", head: true })
    .eq("saved_menu_id", id);
  await admin
    .from("saved_menu_extras")
    .upsert(
      { saved_menu_id: id, kind, item_id: itemId, per_thaali: perThaali, sort_order: count ?? 0 },
      { onConflict: "saved_menu_id,kind,item_id" }
    );
  await touch(admin, id, user.id);
  refresh(id);
}

export async function removeSavedExtra(formData: FormData) {
  await requirePlanner();
  const id = savedId(formData);
  const rowId = String(formData.get("extra_id") ?? "");
  if (!id || !rowId) return;

  await createAdminClient().from("saved_menu_extras").delete().eq("id", rowId).eq("saved_menu_id", id);
  refresh(id);
}

export async function setSavedExtraCounts(formData: FormData) {
  await requirePlanner();
  const id = savedId(formData);
  const rowId = String(formData.get("extra_id") ?? "");
  if (!id || !rowId) return;

  const perThaali = Number(formData.get("per_thaali") ?? 1);
  const expectedRaw = String(formData.get("expected_count") ?? "").trim();
  const expected = expectedRaw === "" ? null : Math.round(Number(expectedRaw));
  await createAdminClient()
    .from("saved_menu_extras")
    .update({
      per_thaali: Number.isFinite(perThaali) && perThaali > 0 ? perThaali : 1,
      expected_count: expected != null && Number.isFinite(expected) && expected >= 0 ? expected : null,
    })
    .eq("id", rowId)
    .eq("saved_menu_id", id);
  refresh(id);
}

export async function setSavedMenuText(formData: FormData) {
  const user = await requirePlanner();
  const id = savedId(formData);
  if (!id) return;

  const text = String(formData.get("menu_text") ?? "").trim();
  await createAdminClient()
    .from("saved_menus")
    .update({ menu_text: text || null, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("id", id);
  refresh(id);
}

export async function addSavedLine(formData: FormData) {
  const user = await requirePlanner();
  const id = savedId(formData);
  const itemId = String(formData.get("item_id") ?? "");
  const unitId = String(formData.get("unit_id") ?? "");
  const quantity = Number(formData.get("quantity") ?? 0);
  const section = String(formData.get("section") ?? "");
  if (!id || !itemId || !unitId) return;
  if (!Number.isFinite(quantity) || quantity <= 0) return;

  const admin = createAdminClient();
  const { count } = await admin
    .from("saved_menu_lines")
    .select("id", { count: "exact", head: true })
    .eq("saved_menu_id", id);
  await admin.from("saved_menu_lines").upsert(
    {
      saved_menu_id: id,
      item_id: itemId,
      quantity,
      unit_id: unitId,
      section: isSection(section) ? section : null,
      sort_order: count ?? 0,
    },
    { onConflict: "saved_menu_id,item_id" }
  );
  await touch(admin, id, user.id);
  refresh(id);
}

export async function setSavedLine(formData: FormData) {
  await requirePlanner();
  const id = savedId(formData);
  const lineId = String(formData.get("line_id") ?? "");
  const quantity = Number(formData.get("quantity") ?? 0);
  const unitId = String(formData.get("unit_id") ?? "");
  const section = String(formData.get("section") ?? "");
  if (!id || !lineId || !Number.isFinite(quantity) || quantity <= 0) return;

  await createAdminClient()
    .from("saved_menu_lines")
    .update({ quantity, ...(unitId ? { unit_id: unitId } : {}), section: isSection(section) ? section : null })
    .eq("id", lineId)
    .eq("saved_menu_id", id);
  refresh(id);
}

export async function removeSavedLine(formData: FormData) {
  await requirePlanner();
  const id = savedId(formData);
  const lineId = String(formData.get("line_id") ?? "");
  if (!id || !lineId) return;

  await createAdminClient().from("saved_menu_lines").delete().eq("id", lineId).eq("saved_menu_id", id);
  refresh(id);
}

/** A day's menu, kept to use again (#17). */
export async function saveDayAsMenu(formData: FormData) {
  const user = await requirePlanner();
  const dayId = String(formData.get("menu_day_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!dayId || !name) return;

  const admin = createAdminClient();
  const { data: day } = await admin
    .from("menu_days")
    .select("planned_thaalis, confirmed_thaalis, menu_text")
    .eq("id", dayId)
    .maybeSingle();
  if (!day) return;

  const { data: created } = await admin
    .from("saved_menus")
    .insert({
      name,
      saved: true,
      favourite: formData.get("favourite") === "on",
      thaalis: Number(day.confirmed_thaalis ?? day.planned_thaalis ?? 0),
      menu_text: day.menu_text ?? null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();
  if (!created) return;

  await copyContents(admin, dayHolder(dayId), savedHolder(created.id as string), user.id);
  revalidatePath("/menus/saved");
  redirect(`/menus/saved/${created.id}`);
}

/**
 * Put a saved menu on one or more days, in one kitchen or both (#20).
 *
 * The menu is copied, so later changes to it don't reach days already
 * planned. A day's own count is kept; the menu's count is only used where the
 * day has none yet.
 */
export async function applySavedMenu(formData: FormData) {
  const user = await requirePlanner();
  const id = savedId(formData);
  const kitchenChoice = String(formData.get("kitchen") ?? "");
  const rawChoice = String(formData.get("existing") ?? "skip");
  const choice: ExistingDayChoice = rawChoice === "add" || rawChoice === "replace" ? rawChoice : "skip";
  const dates = cleanDates(formData.getAll("dates").map(String)).slice(0, MAX_DAYS);
  const returnTo = String(formData.get("return_to") ?? "");
  if (!id || dates.length === 0) return;

  const admin = createAdminClient();
  const { data: menu } = await admin.from("saved_menus").select("name, thaalis, menu_text").eq("id", id).maybeSingle();
  if (!menu) return;

  const kitchens = await loadKitchens(admin);
  const kitchenIds =
    kitchenChoice === "all" ? kitchens.map((k) => k.id) : kitchens.filter((k) => k.id === kitchenChoice).map((k) => k.id);
  if (kitchenIds.length === 0) return;

  const summary = emptySummary();
  for (const kitchenId of kitchenIds) {
    for (const date of dates) {
      const { data: existing } = await admin
        .from("menu_days")
        .select("id, status, menu_text, planned_thaalis")
        .eq("kitchen_id", kitchenId)
        .eq("service_date", date)
        .maybeSingle();

      const existingId = existing?.id as string | undefined;
      const blockers = existingId ? await menuDayBlockers(admin, existingId) : { bought: 0, allocated: 0 };
      const target = {
        exists: Boolean(existing),
        hasContent: existingId
          ? Boolean(existing?.menu_text) || (await hasContents(admin, dayHolder(existingId)))
          : false,
        released: existing?.status === "released",
        bought: blockers.bought > 0 || blockers.allocated > 0,
      };
      const outcome = outcomeFor(target, choice);
      summary[outcome] += 1;
      if (outcome === "skip_has_menu" || outcome === "skip_bought") continue;

      let dayId = existingId;
      if (!dayId) {
        const { data: created } = await admin
          .from("menu_days")
          .insert({ kitchen_id: kitchenId, service_date: date, created_by: user.id, updated_by: user.id })
          .select("id")
          .single();
        dayId = created?.id as string | undefined;
      }
      if (!dayId) continue;

      if (outcome === "replace") await clearContents(admin, dayHolder(dayId));
      await copyContents(admin, savedHolder(id), dayHolder(dayId), user.id);

      const savedText = (menu.menu_text as string | null) ?? null;
      const dayText = outcome === "replace" ? null : ((existing?.menu_text as string | null) ?? null);
      const unrelease = needsUnrelease(target, outcome);
      if (unrelease) {
        summary.unreleased += 1;
        await admin.from("menu_requirements").delete().eq("menu_day_id", dayId).eq("status", "to_order");
      }
      await admin
        .from("menu_days")
        .update({
          menu_text: dayText && savedText ? `${dayText}\n${savedText}` : (dayText ?? savedText),
          ...(Number(existing?.planned_thaalis ?? 0) === 0 && Number(menu.thaalis) > 0
            ? { planned_thaalis: Number(menu.thaalis) }
            : {}),
          ...(unrelease ? { status: "draft", released_at: null, released_by: null } : {}),
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dayId);
      await logDayChange(admin, {
        dayId,
        userId: user.id,
        action: outcome === "replace" ? "Replaced the menu with a saved one" : "Used a saved menu",
        detail: (menu.name as string | null) ?? "an unsaved menu",
      });
    }
  }

  revalidatePath("/menus");
  revalidatePath("/menus/[date]", "page");
  revalidatePath("/menus/sheet");
  revalidatePath("/procurement");
  refresh(id);

  const done = encodeURIComponent(describeSummary(summary));
  // Only ever back to a page of this app.
  const back = returnTo.startsWith("/menus/") ? returnTo : `/menus/saved/${id}`;
  redirect(`${back}${back.includes("?") ? "&" : "?"}done=${done}`);
}

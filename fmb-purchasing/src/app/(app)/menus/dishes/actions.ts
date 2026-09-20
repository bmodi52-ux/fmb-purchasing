"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";

/**
 * The dish library (#70): a dish written once, used on any number of days.
 *
 * A recipe is stated either per batch — how the kitchen works today — or per
 * thaali, and the dish says which, so neither has to be converted by hand.
 */

async function requireDishEditor() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "manage");
  return user;
}

export type DishFormState = { error: string | null; dishId?: string };

type DishShape = { recipe_basis: "batch" | "box"; batch_boxes: number | null; portion_ml: number };

/** The box a dish fills, and whether its quantities are for one or for a batch. */
function shapeFrom(formData: FormData): DishShape | string {
  const portion = Math.round(Number(formData.get("portion_ml") ?? 0));
  if (!Number.isFinite(portion) || portion <= 0) return "Say what size box this dish fills.";

  const basis = String(formData.get("recipe_basis") ?? "batch");
  if (basis !== "batch" && basis !== "box") return "Choose whether the recipe is per box or per batch.";
  if (basis === "box") return { recipe_basis: "box", batch_boxes: null, portion_ml: portion };

  const size = Math.round(Number(formData.get("batch_boxes") ?? 0));
  if (!Number.isFinite(size) || size <= 0) return "Say how many boxes one batch fills.";
  return { recipe_basis: "batch", batch_boxes: size, portion_ml: portion };
}

export async function createDish(_prev: DishFormState, formData: FormData): Promise<DishFormState> {
  const user = await requireDishEditor();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "A dish needs a name." };

  const shape = shapeFrom(formData);
  if (typeof shape === "string") return { error: shape };

  const { data, error } = await createAdminClient()
    .from("dishes")
    .insert({
      name,
      ...shape,
      notes: String(formData.get("notes") ?? "").trim() || null,
      created_by: user.id,
      updated_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    return {
      error: error.code === "23505" ? `There is already a dish called "${name}".` : error.message,
    };
  }

  revalidatePath("/dishes");
  return { error: null, dishId: data.id as string };
}

export async function updateDish(formData: FormData) {
  const user = await requireDishEditor();
  const dishId = String(formData.get("dish_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!dishId || !name) return;

  const shape = shapeFrom(formData);
  if (typeof shape === "string") return;

  await createAdminClient()
    .from("dishes")
    .update({
      name,
      ...shape,
      notes: String(formData.get("notes") ?? "").trim() || null,
      active: formData.get("active") === "on",
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", dishId);

  revalidatePath(`/dishes/${dishId}`);
  revalidatePath("/dishes");
  revalidatePath("/menus");
}

export async function addIngredient(formData: FormData) {
  await requireDishEditor();
  const dishId = String(formData.get("dish_id") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  const unitId = String(formData.get("unit_id") ?? "");
  const quantity = Number(formData.get("quantity") ?? 0);
  if (!dishId || !itemId || !unitId || !(quantity > 0)) return;

  const admin = createAdminClient();
  const { count } = await admin
    .from("dish_ingredients")
    .select("id", { count: "exact", head: true })
    .eq("dish_id", dishId);

  await admin.from("dish_ingredients").insert({
    dish_id: dishId,
    item_id: itemId,
    unit_id: unitId,
    quantity,
    note: String(formData.get("note") ?? "").trim() || null,
    sort_order: count ?? 0,
  });

  revalidatePath(`/dishes/${dishId}`);
  revalidatePath("/menus");
}

export async function updateIngredient(formData: FormData) {
  await requireDishEditor();
  const id = String(formData.get("ingredient_id") ?? "");
  const dishId = String(formData.get("dish_id") ?? "");
  const quantity = Number(formData.get("quantity") ?? 0);
  const unitId = String(formData.get("unit_id") ?? "");
  if (!id || !dishId || !unitId || !(quantity > 0)) return;

  await createAdminClient()
    .from("dish_ingredients")
    .update({ quantity, unit_id: unitId, note: String(formData.get("note") ?? "").trim() || null })
    .eq("id", id)
    .eq("dish_id", dishId);

  revalidatePath(`/dishes/${dishId}`);
  revalidatePath("/menus");
}

export async function removeIngredient(formData: FormData) {
  await requireDishEditor();
  const id = String(formData.get("ingredient_id") ?? "");
  const dishId = String(formData.get("dish_id") ?? "");
  if (!id || !dishId) return;

  await createAdminClient().from("dish_ingredients").delete().eq("id", id).eq("dish_id", dishId);

  revalidatePath(`/dishes/${dishId}`);
  revalidatePath("/menus");
}

/**
 * The sizes the dish forms offer.
 *
 * Only two are filled today, and the rest of what the form used to list was
 * guesswork. Rather than guess again, the list is somebody's to keep: adding
 * a size puts it on the form, removing one takes it off. A dish already
 * written for a size keeps it, so removing one is safe — it stops being
 * offered, it does not repackage anything.
 */
export async function addBoxSize(formData: FormData): Promise<void> {
  const user = await requireDishEditor();

  const ml = Math.round(Number(formData.get("ml") ?? 0));
  if (!Number.isFinite(ml) || ml <= 0) return;

  await createAdminClient()
    .from("box_sizes")
    .upsert({ ml, active: true, created_by: user.id }, { onConflict: "ml" });

  revalidatePath("/menus/dishes");
}

export async function removeBoxSize(formData: FormData): Promise<void> {
  await requireDishEditor();

  const ml = Math.round(Number(formData.get("ml") ?? 0));
  if (!Number.isFinite(ml) || ml <= 0) return;

  // Kept rather than deleted: a size that comes back should not look new, and
  // the row remembers who put it there in the first place.
  await createAdminClient().from("box_sizes").update({ active: false }).eq("ml", ml);

  revalidatePath("/menus/dishes");
}

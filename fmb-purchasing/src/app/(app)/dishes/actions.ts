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

function basisFrom(formData: FormData): { recipe_basis: "batch" | "thaali"; batch_thaalis: number | null } | string {
  const basis = String(formData.get("recipe_basis") ?? "batch");
  if (basis !== "batch" && basis !== "thaali") return "Choose whether the recipe is per batch or per thaali.";
  if (basis === "thaali") return { recipe_basis: "thaali", batch_thaalis: null };

  const size = Math.round(Number(formData.get("batch_thaalis") ?? 0));
  if (!Number.isFinite(size) || size <= 0) return "Say how many thaalis one batch makes.";
  return { recipe_basis: "batch", batch_thaalis: size };
}

export async function createDish(_prev: DishFormState, formData: FormData): Promise<DishFormState> {
  const user = await requireDishEditor();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "A dish needs a name." };

  const basis = basisFrom(formData);
  if (typeof basis === "string") return { error: basis };

  const { data, error } = await createAdminClient()
    .from("dishes")
    .insert({
      name,
      ...basis,
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

  const basis = basisFrom(formData);
  if (typeof basis === "string") return;

  await createAdminClient()
    .from("dishes")
    .update({
      name,
      ...basis,
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

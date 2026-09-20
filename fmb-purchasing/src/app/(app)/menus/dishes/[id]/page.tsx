import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { formatPlainDate } from "@/lib/format";
import { unitOptionLabel } from "@/lib/pack-description";
import { boxSizeOptions, costMenuDay, portionLabel, type MenuDish } from "@/lib/menu-costing";
import { loadBoxSizes, loadDishes, loadItemPrices } from "../../data";
import { addIngredient, removeIngredient, updateDish, updateIngredient } from "../actions";

export const metadata = { title: "Dish" };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/**
 * One dish: what it takes, and what that costs at today's prices (#70).
 *
 * The cost here is the dish on its own, at the scale it is written for. What
 * a day costs is the same arithmetic over every dish on it, and lives on the
 * menu day.
 */
export default async function DishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "view");
  const canManage = can(await getUserPermissions(user), "menus", "manage");

  const admin = createAdminClient();
  const [{ data: dish }, { data: units }, { data: items }, boxSizes] = await Promise.all([
    admin.from("dishes").select("*").eq("id", id).maybeSingle(),
    admin.from("units").select("id, code, label").order("sort_order"),
    admin.from("items").select("id, name, item_number").order("name"),
    loadBoxSizes(admin),
  ]);
  if (!dish) notFound();

  const [{ data: ingredientRows }, { data: servedRows }] = await Promise.all([
    admin
      .from("dish_ingredients")
      .select("id, item_id, quantity, unit_id, note, sort_order, items ( name, item_number )")
      .eq("dish_id", id)
      .order("sort_order"),
    admin
      .from("menu_day_dishes")
      .select("menu_days ( service_date, planned_thaalis, kitchens ( name ) )")
      .eq("dish_id", id),
  ]);

  const [recipe] = await loadDishes(admin, [id]);
  const prices = await loadItemPrices(admin, (recipe?.ingredients ?? []).map((i) => i.itemId));
  // Costed at the scale the recipe is written for: one batch, or one thaali.
  const scale = dish.recipe_basis === "batch" ? Number(dish.batch_boxes ?? 0) : 1;
  const cost = recipe ? costMenuDay([recipe as MenuDish], scale, prices) : null;

  const served = (servedRows ?? [])
    .map((r) => (Array.isArray(r.menu_days) ? r.menu_days[0] : r.menu_days) as
      | { service_date: string; planned_thaalis: number; kitchens: { name: string } | { name: string }[] | null }
      | null)
    .filter((d): d is NonNullable<typeof d> => !!d)
    .sort((a, b) => b.service_date.localeCompare(a.service_date));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/menus/dishes" className="text-sm text-ink/50 hover:text-ink">
          ← Menus · Dishes
        </Link>
        <h1 className="page-title mt-1 text-ink">{dish.name}</h1>
        <p className="mt-1 text-sm text-ink/60">
          {dish.recipe_basis === "batch"
            ? `Written per batch of ${dish.batch_boxes} × ${portionLabel(dish.portion_ml)}`
            : `Written per ${portionLabel(dish.portion_ml)}`}
          {!dish.active && <span className="ml-2 text-ink/45">· retired</span>}
        </p>
      </div>

      {canManage && (
        <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
          <h2 className="mb-4 section-title text-ink">Details</h2>
          <form action={updateDish} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <input type="hidden" name="dish_id" value={dish.id} />
            <FormResetBoundary>
              <label className="flex flex-col gap-1 text-sm sm:col-span-3">
                <span className="text-ink/70">Name</span>
                <input name="name" defaultValue={dish.name} required className="input" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Goes in a</span>
                <select key={dish.portion_ml} name="portion_ml" defaultValue={dish.portion_ml} className="input">
                  {boxSizeOptions(boxSizes, dish.portion_ml).map((ml) => (
                    <option key={ml} value={ml}>
                      {portionLabel(ml)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Recipe is written</span>
                <select key={dish.recipe_basis} name="recipe_basis" defaultValue={dish.recipe_basis} className="input">
                  <option value="batch">per batch</option>
                  <option value="box">per box</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Boxes per batch</span>
                <input name="batch_boxes" type="number" min="1" defaultValue={dish.batch_boxes ?? ""} className="input" />
              </label>
              <label className="flex items-center gap-2 self-end text-sm">
                <input type="checkbox" name="active" defaultChecked={dish.active} />
                In use
              </label>
              <label className="flex flex-col gap-1 text-sm sm:col-span-3">
                <span className="text-ink/70">Notes</span>
                <input name="notes" defaultValue={dish.notes ?? ""} className="input" />
              </label>
            </FormResetBoundary>
            <SubmitButton className="self-start rounded-md bg-gold px-5 py-2.5 font-medium text-ink hover:bg-gold-deep sm:col-span-3">
              Save changes
            </SubmitButton>
          </form>
        </section>
      )}

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-1 section-title text-ink">What goes in</h2>
        <p className="mb-4 text-sm text-ink/55">
          {dish.recipe_basis === "batch"
            ? `Quantities for one batch — ${dish.batch_boxes} × ${portionLabel(dish.portion_ml)}.`
            : `Quantities for one ${portionLabel(dish.portion_ml)}.`}{" "}
          Each ingredient is a Pricelist item, which is what carries its price.
        </p>

        {(ingredientRows ?? []).length === 0 ? (
          <p className="text-sm text-ink/55">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {(ingredientRows ?? []).map((row) => {
              const item = (Array.isArray(row.items) ? row.items[0] : row.items) as
                | { name: string; item_number: string | null }
                | null;
              const line = cost?.lines.find((l) => l.itemId === row.item_id);
              return (
                <li key={row.id} className="rounded-md border border-ink/10 bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-ink">
                      {item?.name ?? "Item"}
                      {item?.item_number && <span className="ml-1.5 font-mono text-xs text-ink/40">{item.item_number}</span>}
                    </span>
                    <span className="font-mono text-ink/70">
                      {Number(row.quantity)} {unitOptionLabel(units?.find((u) => u.id === row.unit_id)?.label ?? "")}
                    </span>
                  </div>
                  {row.note && <p className="mt-0.5 text-xs text-ink/50">{row.note}</p>}

                  {canManage && (
                    <details className="mt-2 text-xs text-ink/50">
                      <summary className="cursor-pointer hover:text-ink">Edit</summary>
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <form action={updateIngredient} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="ingredient_id" value={row.id} />
                          <input type="hidden" name="dish_id" value={dish.id} />
                          <FormResetBoundary>
                            <label className="flex flex-col gap-1">
                              <span className="text-ink/60">Quantity</span>
                              <input
                                name="quantity"
                                type="number"
                                step="0.001"
                                min="0"
                                defaultValue={Number(row.quantity)}
                                className="input w-28"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-ink/60">Unit</span>
                              <select key={row.unit_id} name="unit_id" defaultValue={row.unit_id} className="input">
                                {(units ?? []).map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {unitOptionLabel(u.label)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-ink/60">Note</span>
                              <input name="note" defaultValue={row.note ?? ""} className="input" />
                            </label>
                          </FormResetBoundary>
                          <SubmitButton className="rounded-md border border-ink/15 px-3 py-2 hover:border-ink/30">
                            Save
                          </SubmitButton>
                        </form>
                        <form action={removeIngredient}>
                          <input type="hidden" name="ingredient_id" value={row.id} />
                          <input type="hidden" name="dish_id" value={dish.id} />
                          <SubmitButton className="px-2 py-2 text-maroon/70 hover:underline">Remove</SubmitButton>
                        </form>
                      </div>
                    </details>
                  )}

                  {line && (
                    <p className="mt-1 text-xs text-ink/45">
                      {line.quantity} {line.baseUnitCode}
                      {line.cost != null
                        ? ` · ${money(line.cost)} at ${money(line.perUnit ?? 0)}/${line.baseUnitCode}`
                        : " · no price yet"}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canManage && (
          <form action={addIngredient} className="mt-4 flex flex-wrap items-end gap-2 border-t border-ink/10 pt-4">
            <input type="hidden" name="dish_id" value={dish.id} />
            <FormResetBoundary>
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                <span className="text-ink/70">Item</span>
                <select name="item_id" required defaultValue="" className="input">
                  <option value="" disabled>
                    — choose an item —
                  </option>
                  {(items ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.item_number ? ` (${i.item_number})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Quantity</span>
                <input name="quantity" type="number" step="0.001" min="0" required className="input w-28" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">Unit</span>
                <select name="unit_id" required defaultValue="" className="input">
                  <option value="" disabled>
                    —
                  </option>
                  {(units ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {unitOptionLabel(u.label)}
                    </option>
                  ))}
                </select>
              </label>
            </FormResetBoundary>
            <SubmitButton className="rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30">
              + Add ingredient
            </SubmitButton>
          </form>
        )}
      </section>

      {cost && cost.lines.length > 0 && (
        <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
          <h2 className="mb-1 section-title text-ink">What it costs</h2>
          <p className="mb-3 text-sm text-ink/55">
            At today&apos;s prices, for{" "}
            {dish.recipe_basis === "batch"
              ? `one batch — ${scale} × ${portionLabel(dish.portion_ml)}`
              : `one ${portionLabel(dish.portion_ml)}`}.
            Prices come from what was actually paid where there is any, and from a vendor&apos;s quote otherwise.
          </p>
          <p className="font-mono text-lg text-ink">
            {money(cost.total)}
            {cost.perThaali != null && (
              <span className="ml-2 text-sm text-ink/60">· {money(cost.perThaali)} a box</span>
            )}
          </p>
          {cost.unpriced > 0 && (
            <p className="mt-1 text-xs text-alert">
              {cost.unpriced} {cost.unpriced === 1 ? "ingredient has" : "ingredients have"} no price yet, so this is
              less than the real cost.
            </p>
          )}
        </section>
      )}

      {served.length > 0 && (
        <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
          <h2 className="mb-3 section-title text-ink">Days it was served</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {served.slice(0, 20).map((d, i) => {
              const kitchen = Array.isArray(d.kitchens) ? d.kitchens[0] : d.kitchens;
              return (
                <li key={`${d.service_date}-${i}`} className="flex flex-wrap gap-x-3 text-ink/70">
                  <Link href={`/menus/${d.service_date}`} className="underline-offset-2 hover:underline">
                    {formatPlainDate(d.service_date)}
                  </Link>
                  <span className="text-ink/45">
                    {kitchen?.name}
                    {d.planned_thaalis > 0 && ` · ${d.planned_thaalis} thaalis`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

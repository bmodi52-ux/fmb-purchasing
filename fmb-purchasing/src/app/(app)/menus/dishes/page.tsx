import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlainDate } from "@/lib/format";
import { NewDishForm } from "./new-dish-form";
import { MenuTabs } from "../tabs";
import { portionLabel } from "@/lib/menu-costing";
import { loadBoxSizes } from "../data";
import { BoxSizes } from "./box-sizes";

export const metadata = { title: "Dishes" };

/**
 * The dish library (#70).
 *
 * The sheet this replaces names a dish in a cell — "Thaali- Bhuna gosht with
 * roti" — and says nothing about what it takes to make. Here a dish is
 * written once, with what goes into it, and every day that serves it shares
 * the same recipe: correcting it corrects every future day at once.
 */
export default async function DishesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "view");

  const canManage = can(await getUserPermissions(user), "menus", "manage");
  const admin = createAdminClient();

  const [{ data: dishes }, { data: ingredientCounts }, { data: served }, boxSizes] = await Promise.all([
    admin.from("dishes").select("id, name, recipe_basis, batch_boxes, portion_ml, active").order("name"),
    admin.from("dish_ingredients").select("dish_id"),
    // When each dish was last cooked, which is the history the sheet keeps
    // only by scrolling sideways through old columns.
    admin.from("menu_day_dishes").select("dish_id, menu_days ( service_date )"),
    loadBoxSizes(admin),
  ]);

  const ingredientsByDish = new Map<string, number>();
  for (const row of ingredientCounts ?? []) {
    const id = row.dish_id as string;
    ingredientsByDish.set(id, (ingredientsByDish.get(id) ?? 0) + 1);
  }

  const lastServed = new Map<string, string>();
  const timesServed = new Map<string, number>();
  for (const row of served ?? []) {
    const id = row.dish_id as string;
    const day = Array.isArray(row.menu_days) ? row.menu_days[0] : row.menu_days;
    const date = (day as { service_date?: string } | null)?.service_date;
    timesServed.set(id, (timesServed.get(id) ?? 0) + 1);
    if (date && (!lastServed.has(id) || date > lastServed.get(id)!)) lastServed.set(id, date);
  }

  const live = (dishes ?? []).filter((d) => d.active);
  const retired = (dishes ?? []).filter((d) => !d.active);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title text-ink">Thaali Calendar</h1>
        <p className="page-description mt-1 max-w-2xl">
          What each dish takes to make. Each day works out its own quantities from its thaali count.
        </p>
      </div>

      <MenuTabs active="dishes" />

      {canManage && <NewDishForm boxSizes={boxSizes} />}

      <section className="flex flex-col gap-3">
        {live.length === 0 ? (
          <p className="text-sm text-ink/55">No dishes yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {live.map((d) => (
              <li key={d.id} className="card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Link href={`/menus/dishes/${d.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                    {d.name}
                  </Link>
                  <span className="text-sm text-ink/55">
                    {d.recipe_basis === "batch"
                      ? `per batch of ${d.batch_boxes} × ${portionLabel(d.portion_ml)}`
                      : `per ${portionLabel(d.portion_ml)}`}
                    <span className="text-ink/30"> · </span>
                    {ingredientsByDish.get(d.id) ?? 0}{" "}
                    {(ingredientsByDish.get(d.id) ?? 0) === 1 ? "ingredient" : "ingredients"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink/50">
                  {lastServed.has(d.id)
                    ? `Last served ${formatPlainDate(lastServed.get(d.id)!)} · ${timesServed.get(d.id)} ${
                        timesServed.get(d.id) === 1 ? "day" : "days"
                      } in all`
                    : "Not on any menu yet"}
                </p>
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <BoxSizes
            sizes={boxSizes.map((ml) => ({
              ml,
              dishes: (dishes ?? []).filter((d) => d.portion_ml === ml).length,
            }))}
          />
        )}

        {retired.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink/55 hover:text-ink">{retired.length} retired</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {retired.map((d) => (
                <li key={d.id}>
                  <Link href={`/menus/dishes/${d.id}`} className="text-ink/60 underline-offset-2 hover:underline">
                    {d.name}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}

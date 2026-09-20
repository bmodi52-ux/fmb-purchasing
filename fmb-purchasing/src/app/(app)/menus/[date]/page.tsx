import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { formatPlainDate } from "@/lib/format";
import { formatHijri, gregorianToHijri } from "@/lib/hijri/hijri";
import { batchesFor, boxesFilled, costMenuDay, portionLabel, PRICE_BASIS_LABEL } from "@/lib/menu-costing";
import { loadDishes, loadItemPrices, loadKitchens } from "../data";
import { addDishToDay, copyMenuFromDay, removeDishFromDay, setDayCounts } from "../actions";

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return { title: `Menu · ${date}` };
}

/**
 * One day in one kitchen (#70): the dishes, the count, and what it costs.
 *
 * Quantities are never typed here — they fall out of the recipes and the
 * count, which is the whole difference from the sheet. What is typed is the
 * menu and the number of thaalis.
 */
export default async function MenuDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ kitchen?: string }>;
}) {
  const [{ date }, { kitchen: kitchenParam }] = await Promise.all([params, searchParams]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "view");
  const canManage = can(await getUserPermissions(user), "menus", "manage");

  const admin = createAdminClient();
  const kitchens = await loadKitchens(admin);
  const kitchen = kitchens.find((k) => k.id === kitchenParam) ?? kitchens[0];
  if (!kitchen) notFound();

  const { data: day } = await admin
    .from("menu_days")
    .select("id, planned_thaalis, confirmed_thaalis, status, notes, menu_day_dishes ( id, dish_id, sort_order )")
    .eq("kitchen_id", kitchen.id)
    .eq("service_date", date)
    .maybeSingle();

  const onDay = [...(day?.menu_day_dishes ?? [])].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const dishes = await loadDishes(admin, onDay.map((d) => d.dish_id as string));
  const prices = await loadItemPrices(admin, [...new Set(dishes.flatMap((d) => d.ingredients.map((i) => i.itemId)))]);

  const planned = Number(day?.planned_thaalis ?? 0);
  const confirmed = day?.confirmed_thaalis == null ? null : Number(day.confirmed_thaalis);
  const thaalis = confirmed ?? planned;
  const cost = costMenuDay(dishes, thaalis, prices);

  const [{ data: allDishes }, { data: pastDays }] = await Promise.all([
    admin.from("dishes").select("id, name").eq("active", true).order("name"),
    // Any past day, not only the most recent: menus recur, but not weekly.
    admin
      .from("menu_days")
      .select("id, service_date, kitchens ( name ), menu_day_dishes ( dish_id )")
      .lt("service_date", date)
      .order("service_date", { ascending: false })
      .limit(30),
  ]);

  const onDayIds = new Set(onDay.map((d) => d.dish_id as string));
  const hijri = formatHijri(gregorianToHijri(new Date(`${date}T00:00:00`)));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/menus?kitchen=${kitchen.id}`} className="text-sm text-ink/50 hover:text-ink">
          ← Menus · Calendar
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="page-title text-ink">{formatPlainDate(date)}</h1>
          <span className="text-sm text-ink/55">{hijri}</span>
          {day?.status === "released" && (
            <span className="rounded-full bg-palm/15 px-2 py-0.5 text-xs text-palm">released</span>
          )}
        </div>
        {kitchens.length > 1 && (
          <nav aria-label="Kitchen" className="mt-3 flex flex-wrap gap-1 border-b border-ink/10">
            {kitchens.map((k) => (
              <Link
                key={k.id}
                href={`/menus/${date}?kitchen=${k.id}`}
                aria-current={k.id === kitchen.id ? "page" : undefined}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${
                  k.id === kitchen.id
                    ? "border-gold-deep font-medium text-ink"
                    : "border-transparent text-ink/60 hover:text-ink"
                }`}
              >
                {k.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-1 section-title text-ink">How many</h2>
        <p className="mb-4 text-sm text-ink/55">
          Buying is based on the planned count. The confirmed count arrives closer to the day; both are kept, so the
          difference between them is visible.
        </p>
        <form action={setDayCounts} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="kitchen_id" value={kitchen.id} />
          <input type="hidden" name="date" value={date} />
          <FormResetBoundary>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Planned thaalis</span>
              <input
                name="planned_thaalis"
                type="number"
                min="0"
                defaultValue={planned}
                disabled={!canManage}
                className="input w-32"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">
                Confirmed <span className="text-ink/40">(optional)</span>
              </span>
              <input
                name="confirmed_thaalis"
                type="number"
                min="0"
                defaultValue={confirmed ?? ""}
                disabled={!canManage}
                className="input w-32"
              />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
              <span className="text-ink/70">Notes</span>
              <input name="notes" defaultValue={day?.notes ?? ""} disabled={!canManage} className="input" />
            </label>
          </FormResetBoundary>
          {canManage && (
            <SubmitButton className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-deep">
              Save
            </SubmitButton>
          )}
        </form>
        {confirmed != null && confirmed !== planned && (
          <p className="mt-2 text-sm text-alert">
            Confirmed is {Math.abs(confirmed - planned)} {confirmed > planned ? "more" : "fewer"} than planned —
            quantities below follow the confirmed count.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-4 section-title text-ink">Menu</h2>

        {dishes.length === 0 ? (
          <p className="text-sm text-ink/55">No dishes yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dishes.map((dish) => {
              const row = onDay.find((d) => d.dish_id === dish.dishId);
              const batches = batchesFor(dish, thaalis);
              const filled = boxesFilled(dish, thaalis);
              return (
                <li
                  key={dish.dishId}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-ink/10 bg-white p-3 text-sm"
                >
                  <Link href={`/menus/dishes/${dish.dishId}`} className="text-ink underline-offset-2 hover:underline">
                    {dish.dishName}
                  </Link>
                  <span className="text-ink/55">
                    {dish.basis === "batch"
                      ? `${batches} ${batches === 1 ? "batch" : "batches"} of ${dish.batchBoxes} × ${portionLabel(dish.portionMl)}`
                      : `${thaalis} × ${portionLabel(dish.portionMl)}`}
                    {filled > thaalis && <span className="text-alert"> · fills {filled} boxes</span>}
                  </span>
                  {canManage && row && (
                    <form action={removeDishFromDay}>
                      <input type="hidden" name="menu_day_dish_id" value={row.id as string} />
                      <input type="hidden" name="date" value={date} />
                      <SubmitButton className="text-xs text-maroon/70 hover:underline">remove</SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {canManage && (
          <div className="mt-4 flex flex-col gap-3 border-t border-ink/10 pt-4 sm:flex-row sm:flex-wrap sm:items-end">
            <form action={addDishToDay} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="kitchen_id" value={kitchen.id} />
              <input type="hidden" name="date" value={date} />
              <FormResetBoundary>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-ink/70">Add a dish</span>
                  <select name="dish_id" required defaultValue="" className="input">
                    <option value="" disabled>
                      — choose —
                    </option>
                    {(allDishes ?? [])
                      .filter((d) => !onDayIds.has(d.id as string))
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </select>
                </label>
              </FormResetBoundary>
              <SubmitButton className="rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30">
                Add
              </SubmitButton>
            </form>

            <form action={copyMenuFromDay} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="kitchen_id" value={kitchen.id} />
              <input type="hidden" name="date" value={date} />
              <FormResetBoundary>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-ink/70">Or copy a past menu</span>
                  <select name="source_day_id" required defaultValue="" className="input max-w-xs">
                    <option value="" disabled>
                      — choose a day —
                    </option>
                    {(pastDays ?? [])
                      .filter((d) => (d.menu_day_dishes ?? []).length > 0)
                      .map((d) => {
                        const k = Array.isArray(d.kitchens) ? d.kitchens[0] : d.kitchens;
                        return (
                          <option key={d.id as string} value={d.id as string}>
                            {formatPlainDate(d.service_date as string)} · {(k as { name: string } | null)?.name} ·{" "}
                            {(d.menu_day_dishes ?? []).length} dishes
                          </option>
                        );
                      })}
                  </select>
                </label>
              </FormResetBoundary>
              <SubmitButton className="rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30">
                Copy here
              </SubmitButton>
            </form>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-1 section-title text-ink">What it needs, and what it costs</h2>
        <p className="mb-4 text-sm text-ink/55">
          Worked out from the recipes and {thaalis} {thaalis === 1 ? "thaali" : "thaalis"}, in each item&apos;s own
          unit. Prices are what was last actually paid where there is any, then the cheapest paid lately, then a
          vendor&apos;s quote.
        </p>

        {cost.lines.length === 0 ? (
          <p className="text-sm text-ink/55">Add dishes and a thaali count to see this.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink/50">
                    <th scope="col" className="p-2">Item</th>
                    <th scope="col" className="p-2">Needed</th>
                    <th scope="col" className="p-2">Price</th>
                    <th scope="col" className="p-2">Cost</th>
                    <th scope="col" className="p-2">For</th>
                  </tr>
                </thead>
                <tbody>
                  {cost.lines.map((line) => (
                    <tr key={line.itemId} className="border-t border-ink/5">
                      <td className="p-2 text-ink">{line.itemName}</td>
                      <td className="p-2 font-mono whitespace-nowrap text-ink/80">
                        {line.quantity} {line.baseUnitCode}
                      </td>
                      <td className="p-2 whitespace-nowrap text-ink/60">
                        {line.perUnit == null ? (
                          <span className="text-alert">no price yet</span>
                        ) : (
                          <>
                            <span className="font-mono">
                              {money(line.perUnit)}/{line.baseUnitCode}
                            </span>
                            <span className="block text-xs text-ink/45">{PRICE_BASIS_LABEL[line.basis]}</span>
                          </>
                        )}
                      </td>
                      <td className="p-2 font-mono whitespace-nowrap text-ink/80">
                        {line.cost == null ? "—" : money(line.cost)}
                      </td>
                      <td className="p-2 text-xs text-ink/50">{line.fromDishes.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 border-t border-ink/10 pt-3">
              <span className="text-sm text-ink/60">
                {cost.lines.length} {cost.lines.length === 1 ? "item" : "items"}
                {cost.unpriced > 0 && (
                  <span className="text-alert">
                    {" "}
                    · {cost.unpriced} with no price, so this is less than the real cost
                  </span>
                )}
              </span>
              <span className="font-mono text-lg text-ink">
                {money(cost.total)}
                {cost.perThaali != null && (
                  <span className="ml-2 text-sm text-ink/60">· {money(cost.perThaali)} a thaali</span>
                )}
              </span>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

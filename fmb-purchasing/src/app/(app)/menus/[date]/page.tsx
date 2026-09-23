import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { formatPlainDate } from "@/lib/format";
import { formatHijri, gregorianToHijri } from "@/lib/hijri/hijri";
import {
  batchesFor,
  boxesFor,
  costMenuDay,
  countFor,
  portionLabel,
  PRICE_BASIS_LABEL,
  type MenuExtra,
  type MenuLine,
} from "@/lib/menu-costing";
import { loadDishes, loadExtras, loadItemPrices, loadKitchens, loadMenuLines, loadSections, withDayCounts } from "../data";
import { getSetting } from "@/lib/app-settings";
import { TypedMenu } from "./typed-menu";
import { releaseDay, unreleaseDay } from "../release-actions";
import { progressOf } from "@/lib/procurement";
import {
  addDishToDay,
  addExtraToDay,
  copyMenuFromDay,
  removeDishFromDay,
  removeExtraFromDay,
  setDayCounts,
  setDishCounts,
  setExtraCounts,
} from "../actions";

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
    .select(
      "id, planned_thaalis, confirmed_thaalis, status, notes, menu_text, menu_day_dishes ( id, dish_id, sort_order, boxes_offered, expected_boxes )"
    )
    .eq("kitchen_id", kitchen.id)
    .eq("service_date", date)
    .maybeSingle();

  const onDay = [...(day?.menu_day_dishes ?? [])].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const dishes = withDayCounts(
    await loadDishes(admin, onDay.map((d) => d.dish_id as string)),
    onDay as { dish_id: string; boxes_offered?: number | string | null; expected_boxes?: number | null }[]
  );
  // Roti and fruit are part of the thaali without being dishes (#76); typed
  // lines are a day planned the way the sheet plans it (#77).
  const dayId = day ? (day.id as string) : null;
  const [extrasByDay, linesByDay, mode] = await Promise.all([
    dayId ? loadExtras(admin, [dayId]) : Promise.resolve(new Map<string, MenuExtra[]>()),
    dayId ? loadMenuLines(admin, [dayId]) : Promise.resolve(new Map<string, MenuLine[]>()),
    getSetting(admin, "menu_mode"),
  ]);
  const extras = dayId ? (extrasByDay.get(dayId) ?? []) : [];
  const typedLines = dayId ? (linesByDay.get(dayId) ?? []) : [];
  const simple = mode === "simple";
  const itemIds = [
    ...new Set([
      ...dishes.flatMap((d) => d.ingredients.map((i) => i.itemId)),
      ...extras.map((e) => e.itemId),
      ...typedLines.map((l) => l.itemId),
    ]),
  ];
  const [prices, sectionByItem] = await Promise.all([
    loadItemPrices(admin, itemIds),
    loadSections(admin, typedLines.map((l) => l.itemId)),
  ]);

  const planned = Number(day?.planned_thaalis ?? 0);
  const confirmed = day?.confirmed_thaalis == null ? null : Number(day.confirmed_thaalis);
  const thaalis = confirmed ?? planned;
  const cost = costMenuDay({ dishes, extras, lines: typedLines }, thaalis, prices);

  // Once released, the day has requirements of its own — frozen quantities
  // and prices — and receipts allocated against them.
  const { data: requirements } = day
    ? await admin
        .from("menu_requirements")
        .select("id, item_id, quantity, planned_cost, status, base_unit_code, items ( name )")
        .eq("menu_day_id", day.id)
    : { data: [] };
  const { data: allocations } = (requirements ?? []).length
    ? await admin
        .from("expense_line_allocations")
        .select("menu_requirement_id, quantity, amount")
        .in("menu_requirement_id", (requirements ?? []).map((r) => r.id as string))
    : { data: [] };

  const allocationsBy = new Map<string, { quantity: number; amount: number }[]>();
  for (const a of allocations ?? []) {
    const key = a.menu_requirement_id as string;
    allocationsBy.set(key, [...(allocationsBy.get(key) ?? []), { quantity: Number(a.quantity), amount: Number(a.amount) }]);
  }
  const plannedTotal = (requirements ?? []).reduce((sum, r) => sum + Number(r.planned_cost ?? 0), 0);
  const actualTotal = (allocations ?? []).reduce((sum, a) => sum + Number(a.amount), 0);
  const stillToBuy = (requirements ?? []).filter(
    (r) => !progressOf({ quantity: Number(r.quantity) }, allocationsBy.get(r.id as string) ?? []).complete
  ).length;

  const [{ data: allDishes }, { data: pastDays }, { data: allItems }, { data: allUnits }] = await Promise.all([
    admin.from("dishes").select("id, name").eq("active", true).order("name"),
    // Any past day, not only the most recent: menus recur, but not weekly.
    admin
      .from("menu_days")
      .select("id, service_date, kitchens ( name ), menu_day_dishes ( dish_id )")
      .lt("service_date", date)
      .order("service_date", { ascending: false })
      .limit(30),
    canManage
      ? admin.from("items").select("id, name, item_number").order("name").limit(2000)
      : Promise.resolve({ data: [] }),
    admin.from("units").select("id, code, label").order("sort_order"),
  ]);

  const onDayIds = new Set(onDay.map((d) => d.dish_id as string));
  const hijri = formatHijri(gregorianToHijri(new Date(`${date}T00:00:00`)));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/menus?kitchen=${kitchen.id}`} className="text-sm text-ink/50 hover:text-ink">
          ← Thaali Calendar
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

      {/* A day is releasable once it holds anything to buy: dishes cooked for a
          count, roti somebody has to order, or a list typed straight in (#77). */}
      {canManage &&
        day &&
        ((dishes.length > 0 && thaalis > 0) || extras.length > 0 || typedLines.length > 0) && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white/60 p-4 text-sm">
          <div>
            <p className="text-ink">
              {day.status === "released"
                ? "Released — what this day needs is somebody's to buy."
                : "Not released yet. Releasing works out what the day needs and hands each list to whoever buys it."}
            </p>
            {day.status === "released" && (requirements ?? []).length > 0 && (
              <p className="mt-1 text-xs text-ink/55">
                {(requirements ?? []).length} items · planned {money(plannedTotal)}
                {actualTotal > 0 && ` · spent so far ${money(actualTotal)}`}
                {stillToBuy > 0 && ` · ${stillToBuy} still to buy`}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={releaseDay}>
              <input type="hidden" name="menu_day_id" value={day.id as string} />
              <input type="hidden" name="date" value={date} />
              <SubmitButton className="rounded-md bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-deep">
                {day.status === "released" ? "Release again" : "Release"}
              </SubmitButton>
            </form>
            {day.status === "released" && (
              <>
                <Link
                  href={`/procurement?from=${date}&to=${date}&who=all`}
                  className="rounded-md border border-ink/15 px-4 py-2 hover:border-ink/30"
                >
                  What to buy
                </Link>
                <form action={unreleaseDay}>
                  <input type="hidden" name="menu_day_id" value={day.id as string} />
                  <input type="hidden" name="date" value={date} />
                  <SubmitButton className="rounded-md border border-ink/15 px-4 py-2 text-ink/60 hover:border-ink/30">
                    Back to draft
                  </SubmitButton>
                </form>
              </>
            )}
          </div>
        </section>
      )}

      {simple ? (
        <TypedMenu
          date={date}
          kitchenId={kitchen.id}
          menuText={(day?.menu_text as string | null) ?? null}
          lines={typedLines}
          items={(allItems ?? []).map((i) => ({ id: i.id as string, name: i.name as string }))}
          units={(allUnits ?? []).map((u) => ({ id: u.id as string, code: u.code as string, label: (u.label as string | null) ?? null }))}
          sectionFor={(itemId) => sectionByItem.get(itemId) ?? "dry"}
          canManage={canManage}
        />
      ) : (
        <>
        <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
          <h2 className="mb-4 section-title text-ink">Menu</h2>

          {dishes.length === 0 ? (
            <p className="text-sm text-ink/55">No dishes yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dishes.map((dish) => {
                const row = onDay.find((d) => d.dish_id === dish.dishId);
                const boxes = boxesFor(dish, thaalis);
                const batches = batchesFor(dish, boxes);
                return (
                  <li key={dish.dishId} className="rounded-md border border-ink/10 bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <Link href={`/menus/dishes/${dish.dishId}`} className="text-ink underline-offset-2 hover:underline">
                        {dish.dishName}
                        <span className="ml-2 text-ink/45">
                          {(dish.boxesOffered ?? 1) > 1
                            ? `${dish.boxesOffered} × ${portionLabel(dish.portionMl)} offered`
                            : portionLabel(dish.portionMl)}
                        </span>
                      </Link>
                      <span className="text-ink/55">
                        {boxes} {boxes === 1 ? "box" : "boxes"}
                        {dish.basis === "batch" && ` · ${batches} × the batch of ${dish.batchBoxes}`}
                      </span>
                      {canManage && row && (
                        <form action={removeDishFromDay}>
                          <input type="hidden" name="menu_day_dish_id" value={row.id as string} />
                          <input type="hidden" name="date" value={date} />
                          <SubmitButton className="text-xs text-maroon/70 hover:underline">remove</SubmitButton>
                        </form>
                      )}
                    </div>

                    {canManage && row && (
                      <form action={setDishCounts} className="mt-2 flex flex-wrap items-end gap-2 border-t border-ink/5 pt-2">
                        <input type="hidden" name="menu_day_dish_id" value={row.id as string} />
                        <input type="hidden" name="date" value={date} />
                        <FormResetBoundary>
                          <label className="flex flex-col gap-0.5 text-xs">
                            <span className="text-ink/55">Boxes a thaali may take</span>
                            <input
                              name="boxes_offered"
                              type="number"
                              min="1"
                              step="1"
                              defaultValue={dish.boxesOffered ?? 1}
                              className="input w-20 py-1 text-sm"
                            />
                          </label>
                          <label className="flex flex-col gap-0.5 text-xs">
                            <span className="text-ink/55">Boxes to fill</span>
                            <input
                              name="expected_boxes"
                              type="number"
                              min="0"
                              step="1"
                              defaultValue={dish.expectedBoxes ?? ""}
                              placeholder={String(thaalis * (dish.boxesOffered ?? 1))}
                              className="input w-24 py-1 text-sm"
                            />
                          </label>
                        </FormResetBoundary>
                        <SubmitButton className="rounded border border-ink/15 px-2 py-1 text-xs hover:border-ink/30">
                          Save
                        </SubmitButton>
                        <span className="text-xs text-ink/40">
                          Left blank, everyone takes all {dish.boxesOffered ?? 1} of it.
                        </span>
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
          <div className="mb-3">
            <h2 className="section-title text-ink">Roti, fruit and anything else in the thaali</h2>
            <p className="mt-0.5 text-sm text-ink/55">
              Parts that are bought rather than cooked. How much goes in a thaali is set here and is the same for
              everyone who takes it: a day of half a roti is half a roti, and somebody takes that or takes none. Only
              the number of takers varies.
            </p>
          </div>

          {extras.length === 0 ? (
            <p className="text-sm text-ink/55">Nothing but the dishes today.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {extras.map((extra) => {
                const count = countFor(extra, thaalis);
                return (
                  <li key={extra.extraId} className="rounded-md border border-ink/10 bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="text-ink">
                        {extra.itemName}
                        <span className="ml-2 text-xs uppercase tracking-wide text-ink/40">{extra.kind}</span>
                      </span>
                      <span className="text-ink/55">
                        {extra.perThaali} {extra.unitCode} each · {count} taking it ={" "}
                        <span className="font-mono text-ink/70">
                          {Math.round(extra.perThaali * count * 1000) / 1000} {extra.unitCode}
                        </span>
                      </span>
                      {canManage && (
                        <form action={removeExtraFromDay}>
                          <input type="hidden" name="extra_id" value={extra.extraId} />
                          <input type="hidden" name="date" value={date} />
                          <SubmitButton className="text-xs text-maroon/70 hover:underline">remove</SubmitButton>
                        </form>
                      )}
                    </div>

                    {canManage && (
                      <form
                        action={setExtraCounts}
                        className="mt-2 flex flex-wrap items-end gap-2 border-t border-ink/5 pt-2"
                      >
                        <input type="hidden" name="extra_id" value={extra.extraId} />
                        <input type="hidden" name="date" value={date} />
                        <FormResetBoundary>
                          <label className="flex flex-col gap-0.5 text-xs">
                            <span className="text-ink/55">How much in a thaali</span>
                            <input
                              name="per_thaali"
                              type="number"
                              min="0.01"
                              step="any"
                              defaultValue={extra.perThaali}
                              className="input w-24 py-1 text-sm"
                            />
                          </label>
                          <label className="flex flex-col gap-0.5 text-xs">
                            <span className="text-ink/55">How many take it</span>
                            <input
                              name="expected_count"
                              type="number"
                              min="0"
                              step="1"
                              defaultValue={extra.expectedCount ?? ""}
                              placeholder={String(thaalis)}
                              className="input w-24 py-1 text-sm"
                            />
                          </label>
                        </FormResetBoundary>
                        <SubmitButton className="rounded border border-ink/15 px-2 py-1 text-xs hover:border-ink/30">
                          Save
                        </SubmitButton>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {canManage && (
            <form action={addExtraToDay} className="mt-4 flex flex-wrap items-end gap-2 border-t border-ink/10 pt-4">
              <input type="hidden" name="kitchen_id" value={kitchen.id} />
              <input type="hidden" name="date" value={date} />
              <FormResetBoundary>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-ink/70">Add</span>
                  <select name="kind" defaultValue="roti" className="input">
                    <option value="roti">Roti</option>
                    <option value="fruit">Fruit</option>
                    <option value="other">Something else</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-ink/70">Item</span>
                  <select name="item_id" required defaultValue="" className="input max-w-xs">
                    <option value="" disabled>
                      — choose —
                    </option>
                    {(allItems ?? []).map((i) => (
                      <option key={i.id as string} value={i.id as string}>
                        {i.name as string}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-ink/70">How much each</span>
                  <input name="per_thaali" type="number" min="0.01" step="any" defaultValue="1" className="input w-24" />
                </label>
              </FormResetBoundary>
              <SubmitButton className="rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30">
                Add
              </SubmitButton>
            </form>
          )}
        </section>

        </>
      )}

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-1 section-title text-ink">What it needs, and what it costs</h2>
        <p className="mb-4 text-sm text-ink/55">
          {simple ? (
            <>What was typed in, priced.</>
          ) : (
            <>
              Worked out from the recipes and {thaalis} {thaalis === 1 ? "thaali" : "thaalis"}, in each item&apos;s own
              unit.
            </>
          )}{" "}
          Prices are what was last actually paid where there is any, then the cheapest paid lately, then a
          vendor&apos;s quote.
        </p>

        {cost.lines.length === 0 ? (
          <p className="text-sm text-ink/55">
            {simple ? "List what to buy to see this." : "Add dishes and a thaali count to see this."}
          </p>
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

            {actualTotal > 0 && (
              <div className="mt-4 rounded-md border border-ink/10 bg-cream/60 p-3 text-sm">
                <p className="text-ink">
                  Planned {money(plannedTotal)} · spent {money(actualTotal)}{" "}
                  <span className={actualTotal > plannedTotal ? "text-alert" : "text-palm"}>
                    ({actualTotal > plannedTotal ? "+" : ""}
                    {money(actualTotal - plannedTotal)})
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-ink/55">
                  From the receipts allocated to this day.
                  {stillToBuy > 0 && ` ${stillToBuy} of ${(requirements ?? []).length} items are still to buy, so this is not the final figure.`}
                </p>
              </div>
            )}

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

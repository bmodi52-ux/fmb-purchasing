import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { formatPlainDate } from "@/lib/format";
import { formatHijri, gregorianToHijri } from "@/lib/hijri/hijri";
import { costMenuDay, type MenuExtra, type MenuLine } from "@/lib/menu-costing";
import { CostLinesTable, DishesSection, ExtrasSection } from "../menu-contents";
import { loadDishes, loadExtras, loadItemPrices, loadKitchens, loadMenuLines, loadSections, withDayCounts } from "../data";
import { getSetting } from "@/lib/app-settings";
import { TypedMenu } from "./typed-menu";
import { MenuLayout, MenuSummary } from "../menu-layout";
import { StatusBadge } from "@/components/status-badge";
import { DeleteMenu } from "./delete-menu";
import { releaseDay, unreleaseDay } from "../release-actions";
import { applySavedMenu, saveDayAsMenu } from "../saved/actions";
import { loadDayChanges } from "../day-history";
import { ORG_TIME_ZONE } from "@/lib/format";
import { progressOf } from "@/lib/procurement";
import {
  addDishToDay,
  addExtraToDay,
  addMenuLine,
  copyMenuFromDay,
  removeMenuLine,
  setMenuLine,
  setMenuText,
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
  searchParams: Promise<{ kitchen?: string; done?: string }>;
}) {
  const [{ date }, { kitchen: kitchenParam, done }] = await Promise.all([params, searchParams]);
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

  const [{ data: allDishes }, { data: pastDays }, { data: allItems }, { data: allUnits }, { data: savedMenus }] = await Promise.all([
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
    // Menus kept to use again (#17), favourites first.
    canManage
      ? admin
          .from("saved_menus")
          .select("id, name, favourite")
          .eq("saved", true)
          .order("favourite", { ascending: false })
          .order("name")
      : Promise.resolve({ data: [] }),
  ]);
  const dayHasMenu = dishes.length > 0 || extras.length > 0 || typedLines.length > 0 || Boolean(day?.menu_text);

  // Buying that has happened can't be deleted along with the day (#21).
  const boughtCount = (requirements ?? []).filter((r) => r.status === "ordered" || r.status === "delivered").length;
  const history = await loadDayChanges(admin, kitchen.id, date);
  const changedSinceRelease =
    day?.status === "released" ? history.filter((h) => h.wasReleased && !h.action.startsWith("Released")).length : 0;

  const deleteBlockedBecause =
    boughtCount > 0
      ? `${boughtCount} ${boughtCount === 1 ? "item has" : "items have"} already been ordered or delivered. Take the dishes off one by one instead.`
      : (allocations ?? []).length > 0
        ? "receipts have been allocated to it. Take the dishes off one by one instead."
        : null;

  const hijri = formatHijri(gregorianToHijri(new Date(`${date}T00:00:00`)));

  const longDate = new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const releasable =
    canManage && day && ((dishes.length > 0 && thaalis > 0) || extras.length > 0 || typedLines.length > 0);
  const items = (allItems ?? []).map((i) => ({ id: i.id as string, name: i.name as string }));

  const aside = (
    <MenuSummary
      cost={cost}
      thaalis={thaalis}
      emptyHint={simple ? "List what to buy to see what it costs." : "Add dishes and a thaali count to see what it costs."}
    >
      {/* A day is releasable once it holds anything to buy: dishes cooked for a
          count, roti somebody has to order, or a list typed straight in (#77). */}
      {releasable && day && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-ink/70">
            {day.status === "released"
              ? "Released — what this day needs is somebody's to buy."
              : "Releasing works out what the day needs and hands each list to whoever buys it."}
          </p>
          {day.status === "released" && (requirements ?? []).length > 0 && (
            <p className="text-xs text-ink/55">
              {(requirements ?? []).length} items · planned {money(plannedTotal)}
              {actualTotal > 0 && ` · spent ${money(actualTotal)}`}
              {stillToBuy > 0 && ` · ${stillToBuy} still to buy`}
            </p>
          )}
          <form action={releaseDay}>
            <input type="hidden" name="menu_day_id" value={day.id as string} />
            <input type="hidden" name="date" value={date} />
            <SubmitButton className={`btn w-full ${day.status === "released" ? "btn-secondary" : "btn-primary"}`}>
              {day.status === "released" ? "Release again" : "Release"}
            </SubmitButton>
          </form>
          {day.status === "released" && (
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/procurement?from=${date}&to=${date}&who=all`} className="btn btn-primary">
                What to buy
              </Link>
              <form action={unreleaseDay} className="flex">
                <input type="hidden" name="menu_day_id" value={day.id as string} />
                <input type="hidden" name="date" value={date} />
                <SubmitButton className="btn btn-secondary flex-1">Back to draft</SubmitButton>
              </form>
            </div>
          )}
        </div>
      )}

      {canManage && day && dayHasMenu && (
        <form action={saveDayAsMenu} className="flex flex-col gap-2">
          <input type="hidden" name="menu_day_id" value={day.id as string} />
          <FormResetBoundary>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Save to use again</span>
              <input name="name" required placeholder="e.g. Friday biryani" className="input" />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input type="checkbox" name="favourite" /> Mark as a favourite
            </label>
          </FormResetBoundary>
          <SubmitButton className="btn btn-secondary w-full">Save menu</SubmitButton>
        </form>
      )}

      {canManage && day && (
        <div className="flex items-center justify-between gap-3 text-xs text-ink/50">
          {!deleteBlockedBecause && <span>Start the day again, or take it off the calendar.</span>}
          <DeleteMenu
            dayId={day.id as string}
            date={date}
            dateLabel={formatPlainDate(date)}
            kitchenId={kitchen.id}
            kitchenName={kitchen.name}
            released={day.status === "released"}
            blockedBecause={deleteBlockedBecause}
          />
        </div>
      )}
    </MenuSummary>
  );

  const main = (
    <>
      {done && (
        <p role="status" className="rounded-md border border-palm/30 bg-palm/10 px-4 py-3 text-sm text-ink">
          {done}
        </p>
      )}

      <section className="card p-5">
        <h2 className="mb-3 section-title text-ink">How many</h2>
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
                className="input w-28"
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
                className="input w-28"
              />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
              <span className="text-ink/70">
                Notes <span className="text-ink/40">(optional)</span>
              </span>
              <input name="notes" defaultValue={day?.notes ?? ""} disabled={!canManage} className="input" />
            </label>
          </FormResetBoundary>
          {canManage && <SubmitButton className="btn btn-secondary">Save</SubmitButton>}
        </form>
        {confirmed != null && confirmed !== planned ? (
          <p className="mt-2 text-sm text-alert">
            Confirmed is {Math.abs(confirmed - planned)} {confirmed > planned ? "more" : "fewer"} than planned —
            quantities follow the confirmed count.
          </p>
        ) : (
          <p className="mt-2 text-xs text-ink/50">Buying follows the planned count until a confirmed one is entered.</p>
        )}
      </section>

      {simple ? (
        <TypedMenu
          hidden={{ kitchen_id: kitchen.id, date }}
          rowHidden={{ date }}
          actions={{ setText: setMenuText, addLine: addMenuLine, setLine: setMenuLine, removeLine: removeMenuLine }}
          menuText={(day?.menu_text as string | null) ?? null}
          lines={typedLines}
          items={items}
          units={(allUnits ?? []).map((u) => ({ id: u.id as string, code: u.code as string, label: (u.label as string | null) ?? null }))}
          sectionFor={(itemId) => sectionByItem.get(itemId) ?? "dry"}
          canManage={canManage}
        />
      ) : (
        <>
          <DishesSection
            dishes={dishes}
            rowIdFor={(dishId) => onDay.find((d) => d.dish_id === dishId)?.id as string | undefined}
            rowField="menu_day_dish_id"
            thaalis={thaalis}
            canManage={canManage}
            allDishes={(allDishes ?? []).map((d) => ({ id: d.id as string, name: d.name as string }))}
            hidden={{ kitchen_id: kitchen.id, date }}
            rowHidden={{ date }}
            actions={{ add: addDishToDay, remove: removeDishFromDay, setCounts: setDishCounts }}
          >
            {(savedMenus ?? []).length > 0 && (
              <form action={applySavedMenu} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="kitchen" value={kitchen.id} />
                <input type="hidden" name="dates" value={date} />
                <input type="hidden" name="existing" value="add" />
                <input type="hidden" name="return_to" value={`/menus/${date}?kitchen=${kitchen.id}`} />
                <FormResetBoundary>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-ink/70">
                      Or use a saved menu{" "}
                      <Link href="/menus/saved" className="text-xs text-ink/45 underline underline-offset-2">
                        see all
                      </Link>
                    </span>
                    <select name="saved_menu_id" required defaultValue="" className="input max-w-xs">
                      <option value="" disabled>
                        — choose —
                      </option>
                      {(savedMenus ?? []).map((m) => (
                        <option key={m.id as string} value={m.id as string}>
                          {m.favourite ? "★ " : ""}
                          {m.name as string}
                        </option>
                      ))}
                    </select>
                  </label>
                </FormResetBoundary>
                <SubmitButton className="btn btn-secondary">{dayHasMenu ? "Add" : "Use it"}</SubmitButton>
              </form>
            )}
            <form action={copyMenuFromDay} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="kitchen_id" value={kitchen.id} />
              <input type="hidden" name="date" value={date} />
              <FormResetBoundary>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-ink/70">Or copy a past day</span>
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
              <SubmitButton className="btn btn-secondary">Copy here</SubmitButton>
            </form>
          </DishesSection>

          <ExtrasSection
            extras={extras}
            thaalis={thaalis}
            canManage={canManage}
            allItems={items}
            hidden={{ kitchen_id: kitchen.id, date }}
            rowHidden={{ date }}
            actions={{ add: addExtraToDay, remove: removeExtraFromDay, setCounts: setExtraCounts }}
          />
        </>
      )}

      {cost.lines.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-1 section-title text-ink">What it needs</h2>
          <p className="mb-4 text-sm text-ink/55">
            {simple
              ? "What was typed in, priced."
              : `From the recipes, for ${thaalis} ${thaalis === 1 ? "thaali" : "thaalis"}, in each item's own unit.`}{" "}
            Priced at the cheapest on file — paid or quoted, from any store.
          </p>
          <CostLinesTable lines={cost.lines} />

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
                {stillToBuy > 0 &&
                  ` ${stillToBuy} of ${(requirements ?? []).length} items are still to buy, so this is not the final figure.`}
              </p>
            </div>
          )}
        </section>
      )}

      {/* Who changed what, and whether the lists had gone out yet (#15). */}
      {history.length > 0 && (
        <details className="card p-4 text-sm" open={changedSinceRelease > 0}>
          <summary className="cursor-pointer text-ink">
            History
            <span className="ml-2 text-ink/50">
              {history.length} {history.length === 1 ? "change" : "changes"}
              {changedSinceRelease > 0 && (
                <span className="text-alert"> · {changedSinceRelease} after it was released</span>
              )}
            </span>
          </summary>
          <ul className="mt-3 flex flex-col divide-y divide-ink/5">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                <span className="w-40 shrink-0 text-xs text-ink/50">
                  {new Date(h.changedAt).toLocaleString("en-AU", {
                    timeZone: ORG_TIME_ZONE,
                    day: "numeric",
                    month: "short",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <span className="text-ink">
                  {h.action}
                  {h.detail && <span className="text-ink/60"> · {h.detail}</span>}
                </span>
                <span className="text-xs text-ink/50">
                  {h.changedBy ?? "someone"}
                  {h.wasReleased && !h.action.startsWith("Released") && (
                    <span className="ml-2 rounded-full bg-alert/10 px-2 py-0.5 text-alert">after release</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/menus?kitchen=${kitchen.id}`} className="text-sm text-ink/50 hover:text-ink">
          ← Thaali Calendar
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="page-title text-ink">{longDate}</h1>
          <span className="text-sm text-ink/55">{hijri}</span>
          {day?.status === "released" && <StatusBadge status="approved" label="Released" />}
        </div>
        {kitchens.length > 1 && (
          <nav aria-label="Kitchen" className="tabs mt-3">
            {kitchens.map((k) => (
              <Link
                key={k.id}
                href={`/menus/${date}?kitchen=${k.id}`}
                aria-current={k.id === kitchen.id ? "page" : undefined}
                className="tab"
              >
                {k.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <MenuLayout main={main} aside={aside} cost={cost} />
    </div>
  );
}

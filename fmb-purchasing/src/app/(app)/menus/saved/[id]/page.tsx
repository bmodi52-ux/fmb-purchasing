import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import { getSetting } from "@/lib/app-settings";
import { todayIso } from "@/lib/periods-data";
import { loadKitchens, loadPlannedDates, loadSections } from "../../data";
import { CostLinesTable, DishesSection, ExtrasSection } from "../../menu-contents";
import { TypedMenu } from "../../[date]/typed-menu";
import { ApplyForm } from "../apply-form";
import { loadSavedMenus } from "../data";
import {
  addSavedDish,
  addSavedExtra,
  addSavedLine,
  deleteSavedMenu,
  removeSavedDish,
  removeSavedExtra,
  removeSavedLine,
  saveMenu,
  setSavedCount,
  setSavedDishCounts,
  setSavedExtraCounts,
  setSavedLine,
  setSavedMenuText,
  toggleFavourite,
} from "../actions";

export const metadata = { title: "Menu" };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A menu apart from any day (#17): build it, see what it costs for however
 * many thaalis, keep it, and put it on as many days as it is wanted for (#20).
 */
export default async function SavedMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const [{ id }, { done }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "view");
  const canManage = can(await getUserPermissions(user), "menus", "manage");

  const admin = createAdminClient();
  const [menu] = await loadSavedMenus(admin, { ids: [id] });
  if (!menu) notFound();

  const today = todayIso();
  const [kitchens, mode, planned, { data: allDishes }, { data: allItems }, { data: allUnits }, sectionByItem] =
    await Promise.all([
      loadKitchens(admin),
      getSetting(admin, "menu_mode"),
      loadPlannedDates(admin, addDays(today, -62), addDays(today, 366)),
      admin.from("dishes").select("id, name").eq("active", true).order("name"),
      canManage ? admin.from("items").select("id, name").order("name").limit(2000) : Promise.resolve({ data: [] }),
      admin.from("units").select("id, code, label").order("sort_order"),
      loadSections(admin, menu.lines.map((l) => l.itemId)),
    ]);

  // Typed the way the sheet is typed, or built from dishes: whichever the
  // app is set to, or whichever this menu was made with.
  const simple =
    mode === "simple"
      ? menu.dishes.length === 0
      : menu.dishes.length === 0 && menu.extras.length === 0 && (menu.lines.length > 0 || Boolean(menu.menuText));
  const hasAnything =
    menu.dishes.length > 0 || menu.extras.length > 0 || menu.lines.length > 0 || Boolean(menu.menuText);
  const { cost, thaalis } = menu;
  const hidden = { saved_menu_id: menu.id };
  const items = (allItems ?? []).map((i) => ({ id: i.id as string, name: i.name as string }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/menus/saved" className="text-sm text-ink/50 hover:text-ink">
          ← Saved menus
        </Link>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="page-title text-ink">{menu.saved ? menu.name : "New menu"}</h1>
          {menu.saved && canManage && (
            <form action={toggleFavourite}>
              <input type="hidden" name="saved_menu_id" value={menu.id} />
              <SubmitButton
                aria-pressed={menu.favourite}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  menu.favourite
                    ? "border-gold-deep bg-gold/15 text-ink"
                    : "border-ink/15 text-ink/55 hover:border-ink/30"
                }`}
              >
                {menu.favourite ? "★ Favourite" : "☆ Mark as favourite"}
              </SubmitButton>
            </form>
          )}
          {menu.saved && !canManage && menu.favourite && <span className="text-sm text-gold-deep">★ Favourite</span>}
        </div>
        <p className="page-description mt-1 max-w-2xl">
          {menu.saved
            ? "A menu kept to use again. Changing it here doesn't change days already planned from it."
            : "Build a menu and see what it costs, then put it on days, save it to use again, or both. A menu that isn't saved is cleared after a week; days it was put on keep theirs."}
        </p>
      </div>

      {done && (
        <p role="status" className="rounded-md border border-palm/30 bg-palm/10 px-4 py-3 text-sm text-ink">
          {done}{" "}
          <Link href="/menus" className="underline underline-offset-2">
            See the calendar
          </Link>
        </p>
      )}

      {canManage && (
        <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
          <h2 className="mb-3 section-title text-ink">{menu.saved ? "Name" : "Save to use again"}</h2>
          <form action={saveMenu} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="saved_menu_id" value={menu.id} />
            <FormResetBoundary>
              <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
                <span className="text-ink/70">Name</span>
                <input
                  name="name"
                  required
                  defaultValue={menu.name ?? ""}
                  placeholder="e.g. Friday biryani, 2 kitchens"
                  className="input"
                />
              </label>
              {!menu.saved && (
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" name="favourite" /> Favourite
                </label>
              )}
            </FormResetBoundary>
            <SubmitButton className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-deep">
              {menu.saved ? "Rename" : "Save menu"}
            </SubmitButton>
          </form>
        </section>
      )}

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-1 section-title text-ink">For how many</h2>
        <p className="mb-4 text-sm text-ink/55">
          The estimate is worked out for this count. When the menu is put on a day that has no count yet, the day starts
          with this one.
        </p>
        <form action={setSavedCount} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="saved_menu_id" value={menu.id} />
          <FormResetBoundary>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Thaalis</span>
              <input
                name="thaalis"
                type="number"
                min="0"
                defaultValue={thaalis}
                disabled={!canManage}
                className="input w-32"
              />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
              <span className="text-ink/70">Notes</span>
              <input name="notes" defaultValue={menu.notes ?? ""} disabled={!canManage} className="input" />
            </label>
          </FormResetBoundary>
          {canManage && (
            <SubmitButton className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-ink hover:bg-gold-deep">
              Save
            </SubmitButton>
          )}
        </form>
      </section>

      {simple ? (
        <TypedMenu
          hidden={hidden}
          rowHidden={hidden}
          actions={{ setText: setSavedMenuText, addLine: addSavedLine, setLine: setSavedLine, removeLine: removeSavedLine }}
          menuText={menu.menuText}
          lines={menu.lines}
          items={items}
          units={(allUnits ?? []).map((u) => ({
            id: u.id as string,
            code: u.code as string,
            label: (u.label as string | null) ?? null,
          }))}
          sectionFor={(itemId) => sectionByItem.get(itemId) ?? "dry"}
          canManage={canManage}
        />
      ) : (
        <>
          <DishesSection
            dishes={menu.dishes}
            rowIdFor={(dishId) => menu.dishRowIds.get(dishId)}
            rowField="saved_menu_dish_id"
            thaalis={thaalis}
            canManage={canManage}
            allDishes={(allDishes ?? []).map((d) => ({ id: d.id as string, name: d.name as string }))}
            hidden={hidden}
            rowHidden={hidden}
            actions={{ add: addSavedDish, remove: removeSavedDish, setCounts: setSavedDishCounts }}
          />
          <ExtrasSection
            extras={menu.extras}
            thaalis={thaalis}
            canManage={canManage}
            allItems={items}
            hidden={hidden}
            rowHidden={hidden}
            actions={{ add: addSavedExtra, remove: removeSavedExtra, setCounts: setSavedExtraCounts }}
          />
        </>
      )}

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5">
        <h2 className="mb-1 section-title text-ink">Estimate</h2>
        <p className="mb-4 text-sm text-ink/55">
          {simple ? "What was typed in, priced." : `Worked out from the recipes for ${thaalis} ${thaalis === 1 ? "thaali" : "thaalis"}.`}{" "}
          Prices are what was last actually paid where there is any, then the cheapest paid lately, then a vendor&apos;s
          quote.
        </p>
        {cost.lines.length === 0 ? (
          <p className="text-sm text-ink/55">
            {simple ? "List what to buy to see this." : "Add dishes and a thaali count to see this."}
          </p>
        ) : (
          <>
            <CostLinesTable lines={cost.lines} />
            <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 border-t border-ink/10 pt-3">
              <span className="text-sm text-ink/60">
                {cost.lines.length} {cost.lines.length === 1 ? "item" : "items"}
                {cost.unpriced > 0 && (
                  <span className="text-alert"> · {cost.unpriced} with no price, so this is less than the real cost</span>
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

      {canManage && (
        <section id="put-on-days" className="rounded-lg border border-ink/10 bg-white/60 p-5">
          <h2 className="mb-1 section-title text-ink">Put it on days</h2>
          <p className="mb-4 text-sm text-ink/55">
            Pick one day or several. Each gets its own copy of this menu, which can then be changed on the day.
          </p>
          {hasAnything ? (
            <ApplyForm savedMenuId={menu.id} kitchens={kitchens} planned={planned} today={today} />
          ) : (
            <p className="text-sm text-ink/55">Add something to the menu first.</p>
          )}
        </section>
      )}

      {canManage && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white/60 p-4 text-sm">
          <p className="text-ink/60">
            {menu.saved
              ? "Deleting this doesn't touch days already planned from it."
              : "Don't need this menu? Unsaved, it goes by itself after a week, or now."}
          </p>
          <form action={deleteSavedMenu}>
            <input type="hidden" name="saved_menu_id" value={menu.id} />
            <SubmitButton
              pendingLabel="Deleting…"
              className="rounded-md border border-maroon/30 px-4 py-2 text-sm text-maroon hover:border-maroon/60 hover:bg-maroon/5"
            >
              {menu.saved ? "Delete this saved menu" : "Discard"}
            </SubmitButton>
          </form>
        </section>
      )}
    </div>
  );
}

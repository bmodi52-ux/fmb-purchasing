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
import { MenuLayout, MenuSummary } from "../../menu-layout";
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

  const aside = (
    <MenuSummary
      cost={cost}
      thaalis={thaalis}
      emptyHint={simple ? "List what to buy to see what it costs." : "Add dishes and a thaali count to see what it costs."}
    >
      {canManage && hasAnything && (
        <a href="#put-on-days" className="btn btn-primary w-full">
          Put it on days
        </a>
      )}

      {canManage && (
        <form action={saveMenu} className="flex flex-col gap-2">
          <input type="hidden" name="saved_menu_id" value={menu.id} />
          <FormResetBoundary>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">{menu.saved ? "Name" : "Save to use again"}</span>
              <input
                name="name"
                required
                defaultValue={menu.name ?? ""}
                placeholder="e.g. Friday biryani"
                className="input"
              />
            </label>
            {!menu.saved && (
              <label className="flex items-center gap-2 text-sm text-ink/70">
                <input type="checkbox" name="favourite" /> Mark as a favourite
              </label>
            )}
          </FormResetBoundary>
          <SubmitButton className="btn btn-secondary w-full">{menu.saved ? "Rename" : "Save menu"}</SubmitButton>
        </form>
      )}

      {canManage && (
        <form action={deleteSavedMenu} className="flex items-center justify-between gap-3 text-xs text-ink/50">
          <input type="hidden" name="saved_menu_id" value={menu.id} />
          <span>{menu.saved ? "Days planned from it keep their menus." : "Unsaved, it goes by itself after a week."}</span>
          <SubmitButton pendingLabel="Deleting…" className="btn btn-quiet btn-xs text-maroon">
            {menu.saved ? "Delete" : "Discard"}
          </SubmitButton>
        </form>
      )}
    </MenuSummary>
  );

  const main = (
    <>
      {done && (
        <p role="status" className="rounded-md border border-palm/30 bg-palm/10 px-4 py-3 text-sm text-ink">
          {done}{" "}
          <Link href="/menus" className="underline underline-offset-2">
            See the calendar
          </Link>
        </p>
      )}

      <section className="card p-5">
        <h2 className="mb-3 section-title text-ink">How many</h2>
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
                className="input w-28"
              />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
              <span className="text-ink/70">
                Notes <span className="text-ink/40">(optional)</span>
              </span>
              <input name="notes" defaultValue={menu.notes ?? ""} disabled={!canManage} className="input" />
            </label>
          </FormResetBoundary>
          {canManage && <SubmitButton className="btn btn-secondary">Save</SubmitButton>}
        </form>
        <p className="mt-2 text-xs text-ink/50">A day this is put on that has no count yet starts with this one.</p>
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

      {cost.lines.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-1 section-title text-ink">What it needs</h2>
          <p className="mb-4 text-sm text-ink/55">
            {simple ? "What was typed in, priced." : `From the recipes, for ${thaalis} ${thaalis === 1 ? "thaali" : "thaalis"}.`}{" "}
            Priced at what was last paid, else the cheapest lately, else a quote.
          </p>
          <CostLinesTable lines={cost.lines} />
        </section>
      )}

      {canManage && hasAnything && (
        <section id="put-on-days" className="card scroll-mt-6 p-5">
          <h2 className="mb-1 section-title text-ink">Put it on days</h2>
          <p className="mb-4 text-sm text-ink/55">Each day gets its own copy, which can then be changed on the day.</p>
          <ApplyForm savedMenuId={menu.id} kitchens={kitchens} planned={planned} today={today} />
        </section>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/menus/saved" className="text-sm text-ink/50 hover:text-ink">
          ← Saved menus
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
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
            ? "Kept to use again. Changing it here doesn't change days already planned from it."
            : "Build a menu and see what a thaali costs, then put it on days, save it to use again, or both."}
        </p>
      </div>

      <MenuLayout
        main={main}
        aside={aside}
        cost={cost}
        barAction={canManage && hasAnything ? { href: "#put-on-days", label: "Put on days" } : undefined}
      />
    </div>
  );
}

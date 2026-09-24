import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions, requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubmitButton } from "@/components/submit-button";
import { formatPlainDate } from "@/lib/format";
import { MenuTabs } from "../tabs";
import { describeContents, loadSavedMenus, type SavedMenu } from "./data";
import { newEstimate, toggleFavourite } from "./actions";

export const metadata = { title: "Thaali Calendar · Saved menus" };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/**
 * Menus kept to use again, favourites first, and estimates not saved yet
 * (#17).
 */
export default async function SavedMenusPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "view");
  const canManage = can(await getUserPermissions(user), "menus", "manage");

  const admin = createAdminClient();
  const [saved, estimates] = await Promise.all([
    loadSavedMenus(admin, { saved: true }),
    canManage ? loadSavedMenus(admin, { saved: false }) : Promise.resolve([]),
  ]);
  const favourites = saved.filter((m) => m.favourite);
  const others = saved.filter((m) => !m.favourite);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title text-ink">Thaali Calendar</h1>
        <p className="page-description mt-1 max-w-2xl">
          Menus kept to use again, on as many days as you like.
        </p>
      </div>

      <MenuTabs active="saved" />

      {canManage && (
        <form action={newEstimate}>
          <SubmitButton
            pendingLabel="Starting…"
            className="btn btn-primary"
          >
            + New menu
          </SubmitButton>
        </form>
      )}

      {saved.length === 0 && (
        <p className="text-sm text-ink/55">
          No saved menus yet. Start one above, or save a day&apos;s menu from its page.
        </p>
      )}

      {favourites.length > 0 && <MenuList title="Favourites" menus={favourites} canManage={canManage} />}
      {others.length > 0 && (
        <MenuList title={favourites.length > 0 ? "Other saved menus" : "Saved menus"} menus={others} canManage={canManage} />
      )}

      {estimates.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="section-title text-ink">Menus not saved yet</h2>
          <p className="text-sm text-ink/55">Cleared a week after they were last changed, unless saved. Days they were put on keep their menus.</p>
          <ul className="flex flex-col gap-2">
            {estimates.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/menus/saved/${m.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-dashed border-ink/15 bg-white/50 p-3 text-sm hover:border-ink/30"
                >
                  <span className="text-ink/75">{describeContents(m)}</span>
                  <span className="text-xs text-ink/50">
                    {summaryOf(m)} · last changed {formatPlainDate(m.updatedAt.slice(0, 10))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function summaryOf(m: SavedMenu): string {
  const parts = [`${m.thaalis} thaalis`];
  if (m.cost.perThaali != null) parts.push(`${money(m.cost.perThaali)} a thaali`);
  else if (m.cost.total > 0) parts.push(money(m.cost.total));
  return parts.join(" · ");
}

function MenuList({ title, menus, canManage }: { title: string; menus: SavedMenu[]; canManage: boolean }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="section-title text-ink">{title}</h2>
      <ul className="grid gap-2 md:grid-cols-2">
        {menus.map((m) => (
          <li key={m.id} className="flex flex-col gap-2 card p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <Link href={`/menus/saved/${m.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                {m.name}
              </Link>
              {canManage ? (
                <form action={toggleFavourite}>
                  <input type="hidden" name="saved_menu_id" value={m.id} />
                  <SubmitButton
                    aria-pressed={m.favourite}
                    aria-label={m.favourite ? `Take ${m.name} out of favourites` : `Make ${m.name} a favourite`}
                    className={`text-lg leading-none ${m.favourite ? "text-gold-deep" : "text-ink/25 hover:text-gold-deep"}`}
                  >
                    {m.favourite ? "★" : "☆"}
                  </SubmitButton>
                </form>
              ) : (
                m.favourite && <span className="text-lg leading-none text-gold-deep">★</span>
              )}
            </div>
            <p className="line-clamp-2 text-ink/70">{describeContents(m)}</p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink/55">
              <span className="tabular-nums">{summaryOf(m)}</span>
              {canManage && (
                <Link
                  href={`/menus/saved/${m.id}#put-on-days`}
                  className="btn btn-secondary btn-xs"
                >
                  Put on days
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

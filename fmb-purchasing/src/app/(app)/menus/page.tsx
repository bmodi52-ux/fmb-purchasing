import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildMonthGrid, formatHijri } from "@/lib/hijri/hijri";
import { costMenuDay } from "@/lib/menu-costing";
import { loadDishes, loadItemPrices, loadKitchens } from "./data";
import { MenuTabs } from "./tabs";
import type { MenuDayCost } from "@/lib/menu-costing";
import type { MenuDish } from "@/lib/menu-costing";

/** One kitchen's menu on one day, as a calendar cell shows it. */
type DayEntry = {
  kitchenId: string;
  kitchenName: string;
  dishes: MenuDish[];
  thaalis: number;
  cost: MenuDayCost | null;
};

export const metadata = { title: "Menu calendar" };

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const MONTHS = "January February March April May June July August September October November December".split(" ");

/** YYYY-MM-DD in local terms, since a service date is a day, not an instant. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A month of menus, in both calendars (#70).
 *
 * The sheet it replaces is a column per thaali day, which reads fine for a
 * fortnight and not at all across a year. A month grid is how the days are
 * actually thought about — and it carries the Hijri date, because that is
 * what the occasions are keyed to.
 */
export default async function MenuCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; kitchens?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "view");

  const { month: monthParam, kitchens: kitchensParam } = await searchParams;
  const admin = createAdminClient();

  // One calendar for both kitchens, each switched on or off. Seeing them
  // together is how a week is actually judged; seeing one alone is how a
  // kitchen's own day is planned.
  const kitchens = await loadKitchens(admin);
  const asked = kitchensParam === undefined ? null : new Set(kitchensParam.split(",").filter(Boolean));
  const shown = kitchens.filter((k) => asked === null || asked.has(k.id));
  const showing = shown.length > 0 ? shown : kitchens;
  const showingIds = new Set(showing.map((k) => k.id));

  const today = new Date();
  const [yearStr, monthStr] = (monthParam ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`)
    .split("-");
  const year = Number(yearStr) || today.getFullYear();
  const month = Math.min(12, Math.max(1, Number(monthStr) || today.getMonth() + 1));

  const weeks = buildMonthGrid(year, month);
  const from = isoDate(weeks[0][0].gregorian);
  const to = isoDate(weeks[weeks.length - 1][6].gregorian);

  const { data: days } = await admin
    .from("menu_days")
    .select(
      "id, kitchen_id, service_date, planned_thaalis, confirmed_thaalis, status, menu_day_dishes ( dish_id, sort_order )"
    )
    .in("kitchen_id", [...showingIds])
    .gte("service_date", from)
    .lte("service_date", to)
    .order("service_date");

  // One read of every dish and price on the screen, rather than one per day.
  const dishIds = [
    ...new Set((days ?? []).flatMap((d) => (d.menu_day_dishes ?? []).map((x) => x.dish_id as string))),
  ];
  const dishes = await loadDishes(admin, dishIds);
  const dishById = new Map(dishes.map((d) => [d.dishId, d]));
  const prices = await loadItemPrices(admin, [...new Set(dishes.flatMap((d) => d.ingredients.map((i) => i.itemId)))]);

  // A day can now hold a menu from each kitchen, so the map is date → list.
  const byDate = new Map<string, DayEntry[]>();
  for (const d of days ?? []) {
    const onDay = [...(d.menu_day_dishes ?? [])]
      .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
      .flatMap((x) => dishById.get(x.dish_id as string) ?? []);
    const thaalis = Number(d.confirmed_thaalis ?? d.planned_thaalis);
    const date = d.service_date as string;
    const entry: DayEntry = {
      kitchenId: d.kitchen_id as string,
      kitchenName: kitchens.find((k) => k.id === d.kitchen_id)?.name ?? "",
      dishes: onDay,
      thaalis,
      cost: onDay.length > 0 ? costMenuDay(onDay, thaalis, prices) : null,
    };
    byDate.set(date, [...(byDate.get(date) ?? []), entry]);
  }
  for (const [, entries] of byDate) {
    entries.sort((a, b) => a.kitchenName.localeCompare(b.kitchenName, "en", { sensitivity: "base" }));
  }

  /** What a day cell links to: the first kitchen showing, since a day page is one kitchen's. */
  const dayHref = (date: string) => `/menus/${date}?kitchen=${showing[0]?.id ?? ""}`;
  const kitchensQuery = showingIds.size === kitchens.length ? "" : `&kitchens=${[...showingIds].join(",")}`;

  const monthHref = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    const target = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return `/menus?month=${target}${kitchensQuery}`;
  };

  /** Turning a kitchen off, or back on, without losing the month in view. */
  const toggleHref = (kitchenId: string) => {
    const next = new Set(showingIds);
    if (next.has(kitchenId)) next.delete(kitchenId);
    else next.add(kitchenId);
    const ids = next.size === 0 || next.size === kitchens.length ? "" : `&kitchens=${[...next].join(",")}`;
    return `/menus?month=${year}-${String(month).padStart(2, "0")}${ids}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title text-ink">Menu calendar</h1>
        <p className="page-description mt-1 max-w-2xl">
          What is being cooked, for how many, and what that costs a thaali. A day&apos;s quantities come from its
          dishes and its thaali count, so changing either works the rest out.
        </p>
      </div>

      <MenuTabs active="calendar" />

      {kitchens.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink/55">Kitchens:</span>
          {kitchens.map((k) => {
            const on = showingIds.has(k.id);
            return (
              <Link
                key={k.id}
                href={toggleHref(k.id)}
                aria-pressed={on}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 transition-colors ${
                  on ? "border-gold-deep bg-gold/10 text-ink" : "border-ink/15 text-ink/55 hover:border-ink/30"
                }`}
              >
                <span aria-hidden="true" className={on ? "text-gold-deep" : "text-ink/30"}>
                  {on ? "☑" : "☐"}
                </span>
                {k.name}
              </Link>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title text-ink">
          {MONTHS[month - 1]} {year}
          <span className="ml-2 text-sm font-normal text-ink/50">
            {formatHijri(weeks[1][0].hijri)} – {formatHijri(weeks[weeks.length - 2][6].hijri)}
          </span>
        </h2>
        <div className="flex items-center gap-2 text-sm">
          <Link href={monthHref(-1)} className="rounded-md border border-ink/15 px-3 py-1.5 hover:border-ink/30">
            ← Previous
          </Link>
          <Link
            href={`/menus${kitchensQuery ? `?${kitchensQuery.slice(1)}` : ""}`}
            className="rounded-md border border-ink/15 px-3 py-1.5 hover:border-ink/30"
          >
            This month
          </Link>
          <Link href={monthHref(1)} className="rounded-md border border-ink/15 px-3 py-1.5 hover:border-ink/30">
            Next →
          </Link>
        </div>
      </div>

      {/* A phone gets the days that have something on them, in order: a seven
          column grid at that width is unreadable, and an empty Tuesday is not
          worth a row of its own. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {[...byDate.entries()]
          .filter(([date]) => date >= isoDate(new Date(year, month - 1, 1)) && date <= isoDate(new Date(year, month, 0)))
          .flatMap(([date, entries]) =>
            entries.map((entry) => (
              <li key={`${date}-${entry.kitchenId}`}>
                <Link
                  href={`/menus/${date}?kitchen=${entry.kitchenId}`}
                  className="flex flex-col gap-1 rounded-lg border border-ink/10 bg-white/70 p-3"
                >
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">
                      {new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                    </span>
                    <span className="text-xs text-ink/50">
                      {showing.length > 1 && `${entry.kitchenName} · `}
                      {entry.thaalis} thaalis
                    </span>
                  </span>
                  <span className="text-sm text-ink/70">
                    {entry.dishes.map((d) => d.dishName).join(", ") || "No dishes yet"}
                  </span>
                  {entry.cost?.perThaali != null && (
                    <span className="font-mono text-xs text-ink/55">{money(entry.cost.perThaali)} a thaali</span>
                  )}
                </Link>
              </li>
            ))
          )}
        {byDate.size === 0 && <li className="text-sm text-ink/55">Nothing planned this month.</li>}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full table-fixed border-separate border-spacing-1">
          <thead>
            <tr className="text-xs text-ink/50">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <th key={d} scope="col" className="px-1 pb-1 text-left font-normal">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, i) => (
              <tr key={i}>
                {week.map((cell) => {
                  const date = isoDate(cell.gregorian);
                  const entries = byDate.get(date) ?? [];
                  const isToday = date === isoDate(today);
                  return (
                    <td key={date} className="align-top">
                      <div
                        className={`flex h-36 flex-col rounded-md border text-xs transition-colors ${
                          cell.inCurrentMonth ? "bg-white/70" : "bg-ink/[0.02] text-ink/40"
                        } ${isToday ? "border-gold-deep" : "border-ink/10"}`}
                      >
                        <Link
                          href={dayHref(date)}
                          className="flex items-baseline justify-between gap-1 px-2 pt-2 hover:text-ink"
                        >
                          <span className={`font-medium ${cell.inCurrentMonth ? "text-ink" : ""}`}>
                            {cell.gregorian.getDate()}
                          </span>
                          <span className="text-[0.65rem] text-ink/45">{formatHijri(cell.hijri)}</span>
                        </Link>
                        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1">
                          {entries.map((entry) => (
                            <Link
                              key={entry.kitchenId}
                              href={`/menus/${date}?kitchen=${entry.kitchenId}`}
                              className="rounded border border-ink/10 bg-cream/60 px-1.5 py-1 hover:border-ink/30"
                            >
                              {showing.length > 1 && (
                                <span className="block truncate text-[0.65rem] text-ink/45">{entry.kitchenName}</span>
                              )}
                              <span className="line-clamp-2 text-ink/75">
                                {entry.dishes.map((d) => d.dishName).join(", ") || "No dishes yet"}
                              </span>
                              <span className="text-ink/50">
                                {entry.thaalis > 0 && `${entry.thaalis} thaalis`}
                                {entry.cost?.perThaali != null && (
                                  <span className="block font-mono text-ink/70">
                                    {money(entry.cost.perThaali)}/thaali
                                  </span>
                                )}
                              </span>
                            </Link>
                          ))}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

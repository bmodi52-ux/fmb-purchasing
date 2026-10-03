import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { can, getUserPermissions } from "@/lib/permissions";
import { SubmitButton } from "@/components/submit-button";
import { newEstimate } from "./saved/actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildMonthGrid, formatHijri, formatHijriDay, gregorianToHijri } from "@/lib/hijri/hijri";
import { costMenuDay } from "@/lib/menu-costing";
import { loadDishes, loadExtras, loadItemPrices, loadKitchens, withDayCounts } from "./data";
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
export async function MenuCalendarView({
  user,
  month: monthParam,
  kitchens: kitchensParam,
}: {
  /** Already known to be allowed the calendar: page.tsx does the signing in. */
  user: CurrentUser;
  month?: string;
  kitchens?: string;
}) {
  const canManage = can(await getUserPermissions(user), "menus", "manage");
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
      "id, kitchen_id, service_date, planned_thaalis, confirmed_thaalis, status, menu_day_dishes ( dish_id, sort_order, boxes_offered, expected_boxes )"
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
  // Roti and fruit cost a day as much as its dishes do (#76).
  const extrasByDay = await loadExtras(admin, (days ?? []).map((d) => d.id as string));
  const prices = await loadItemPrices(admin, [
    ...new Set([
      ...dishes.flatMap((d) => d.ingredients.map((i) => i.itemId)),
      ...[...extrasByDay.values()].flat().map((e) => e.itemId),
    ]),
  ]);

  // A day can now hold a menu from each kitchen, so the map is date → list.
  const byDate = new Map<string, DayEntry[]>();
  for (const d of days ?? []) {
    const rows = [...(d.menu_day_dishes ?? [])].sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
    const onDay = withDayCounts(
      rows.flatMap((x) => dishById.get(x.dish_id as string) ?? []),
      rows as { dish_id: string; boxes_offered?: number | string | null; expected_boxes?: number | null }[]
    );
    const extras = extrasByDay.get(d.id as string) ?? [];
    const thaalis = Number(d.confirmed_thaalis ?? d.planned_thaalis);
    const date = d.service_date as string;
    const entry: DayEntry = {
      kitchenId: d.kitchen_id as string,
      kitchenName: kitchens.find((k) => k.id === d.kitchen_id)?.name ?? "",
      dishes: onDay,
      thaalis,
      cost: onDay.length > 0 || extras.length > 0 ? costMenuDay({ dishes: onDay, extras }, thaalis, prices) : null,
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

  // The Hijri days the month's own weeks run between. The year is said once,
  // here, so a cell can carry the day and month alone.
  const firstHijri = weeks[1][0].hijri;
  const lastHijri = weeks[weeks.length - 2][6].hijri;
  const hijriRange =
    firstHijri.year === lastHijri.year
      ? `${formatHijriDay(firstHijri)} – ${formatHijri(lastHijri)}`
      : `${formatHijri(firstHijri)} – ${formatHijri(lastHijri)}`;
  const todayIso = isoDate(today);

  /** "260 thaalis · $4.85/thaali", or as much of it as the day has. */
  const dayFigures = (entry: DayEntry) =>
    [
      entry.thaalis > 0 ? `${entry.thaalis} thaalis` : null,
      entry.cost?.perThaali != null ? `${money(entry.cost.perThaali)}/thaali` : null,
    ].filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Thaali Calendar</h1>
          <p className="page-description mt-1 max-w-2xl">
            What is being cooked, for how many, and what it costs a thaali.
          </p>
        </div>
        {/* One menu, then as many days as it is wanted for (#20). */}
        {canManage && (
          <form action={newEstimate}>
            <SubmitButton pendingLabel="Starting…" className="btn btn-primary control">
              + Add menu
            </SubmitButton>
          </form>
        )}
      </div>

      <MenuTabs active="calendar" />

      {/* The month, then what changes the view of it: which kitchens, and
          which month. Stacked on a phone, where each needs a finger's room. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 className="section-title flex flex-wrap items-baseline gap-x-2.5 text-ink">
          {MONTHS[month - 1]} {year}
          <span className="text-support font-normal tracking-normal text-ink/70 sm:text-body">{hijriRange}</span>
        </h2>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          <div className="grid grid-cols-3 gap-2 sm:order-last sm:flex">
            <Link href={monthHref(-1)} className="btn btn-secondary btn-sm pointer-coarse:h-[2.9333rem] pointer-coarse:text-body">
              ← Previous
            </Link>
            <Link
              href={`/menus${kitchensQuery ? `?${kitchensQuery.slice(1)}` : ""}`}
              className="btn btn-secondary btn-sm pointer-coarse:h-[2.9333rem] pointer-coarse:text-body"
            >
              This month
            </Link>
            <Link href={monthHref(1)} className="btn btn-secondary btn-sm pointer-coarse:h-[2.9333rem] pointer-coarse:text-body">
              Next →
            </Link>
          </div>
          {kitchens.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-support text-ink/70">Kitchens</span>
              {kitchens.map((k) => {
                const on = showingIds.has(k.id);
                return (
                  <Link
                    key={k.id}
                    href={toggleHref(k.id)}
                    aria-pressed={on}
                    className={
                      on
                        ? "chip pointer-coarse:py-2.5"
                        : "inline-flex items-center gap-1.5 rounded-full border border-ink/20 px-[0.7rem] py-1 text-support leading-5 font-medium text-ink/70 hover:border-ink/40 pointer-coarse:py-2.5"
                    }
                  >
                    {on && (
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path
                          d="M3.5 8.4l2.9 2.9 6.1-6.6"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                    {k.name}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="@container">
        {/* Too narrow for seven columns — a phone, a tablet held upright —
            gets the days that have something on them, in order: an empty
            Tuesday is not worth a row of its own. */}
        <ul className="flex flex-col gap-2 @[42rem]:hidden">
          {[...byDate.entries()]
            .filter(([date]) => date >= isoDate(new Date(year, month - 1, 1)) && date <= isoDate(new Date(year, month, 0)))
            .flatMap(([date, entries]) =>
              entries.map((entry) => {
                const day = new Date(`${date}T00:00:00`);
                const isToday = date === todayIso;
                const figures = [showing.length > 1 ? entry.kitchenName : null, ...dayFigures(entry)].filter(Boolean);
                return (
                  <li key={`${date}-${entry.kitchenId}`}>
                    <Link
                      href={`/menus/${date}?kitchen=${entry.kitchenId}`}
                      className={`card flex flex-col gap-0.5 ${isToday ? "border-2 border-brand px-[calc(0.875rem-1px)] py-[calc(0.75rem-1px)]" : "px-3.5 py-3"}`}
                    >
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="flex items-center gap-2 text-base font-semibold text-ink">
                          {day.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
                          {isToday && (
                            <span className="rounded-full bg-brand px-2 py-px text-support font-medium text-white">Today</span>
                          )}
                        </span>
                        <span className="text-support text-ink/70">{formatHijriDay(gregorianToHijri(day))}</span>
                      </span>
                      <span className={`text-body ${entry.dishes.length > 0 ? "text-ink" : "text-ink/70"}`}>
                        {entry.dishes.map((d) => d.dishName).join(", ") || "No dishes yet"}
                      </span>
                      {figures.length > 0 && (
                        <span className="text-support tabular-nums text-ink/70">{figures.join(" · ")}</span>
                      )}
                    </Link>
                  </li>
                );
              })
            )}
          {byDate.size === 0 && <li className="text-body text-ink/70">Nothing planned this month.</li>}
        </ul>

        <div className="hidden @[42rem]:block">
          <table className="w-full table-fixed border-separate border-spacing-1.5">
            <thead>
              <tr className="text-support text-ink/70">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <th key={d} scope="col" className="px-2 pb-0.5 text-left font-semibold">
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
                    const isToday = date === todayIso;
                    return (
                      // A height on the cell is what lets the box inside fill
                      // the row, so a week is as tall as its fullest day and
                      // every day in it matches — nothing scrolls inside a cell.
                      <td key={date} className="h-px p-0 align-top">
                        <div
                          className={`flex h-full min-h-[8.8rem] flex-col rounded-lg ${
                            cell.inCurrentMonth ? "bg-white" : "bg-ink/[0.03]"
                          } ${isToday ? "border-2 border-brand p-[calc(0.5rem-1px)]" : "border border-ink/10 p-2"}`}
                        >
                          <Link
                            href={dayHref(date)}
                            aria-current={isToday ? "date" : undefined}
                            className="flex flex-col gap-0.5 @[54rem]:flex-row @[54rem]:items-center @[54rem]:justify-between @[54rem]:gap-1.5"
                          >
                            <span
                              className={`-ml-1 inline-flex h-[1.7rem] min-w-[1.7rem] items-center justify-center self-start rounded-full px-1.5 text-body font-semibold tabular-nums ${
                                isToday ? "bg-brand text-white" : cell.inCurrentMonth ? "text-ink" : "text-ink/65"
                              }`}
                            >
                              {cell.gregorian.getDate()}
                            </span>
                            <span
                              className={`text-support leading-snug @[54rem]:text-right ${
                                cell.inCurrentMonth ? "text-ink/70" : "text-ink/65"
                              }`}
                            >
                              {/* A hyphen that will not break: "al-Aakhar" goes to the next line whole. */}
                              {formatHijriDay(cell.hijri).replace(/-/g, "\u2011")}
                            </span>
                          </Link>
                          <div className="mt-1.5 flex flex-1 flex-col gap-1">
                            {entries.length === 0 && cell.inCurrentMonth && (
                              <Link
                                href={dayHref(date)}
                                className="flex min-h-[4.5rem] flex-1 items-center justify-center rounded-md border border-dashed border-ink/25 px-1 text-center text-support text-ink/70 hover:border-brand hover:text-brand"
                              >
                                + Set a menu
                              </Link>
                            )}
                            {entries.map((entry) => (
                              <Link
                                key={entry.kitchenId}
                                href={`/menus/${date}?kitchen=${entry.kitchenId}`}
                                className="rounded-md border border-ink/10 bg-cream px-2 py-1.5 text-support leading-snug hover:border-ink/30"
                              >
                                {showing.length > 1 && (
                                  <span className="block truncate text-ink/70">{entry.kitchenName}</span>
                                )}
                                <span
                                  className={`line-clamp-3 ${entry.dishes.length > 0 ? "font-medium text-ink" : "text-ink/70"}`}
                                >
                                  {entry.dishes.map((d) => d.dishName).join(", ") || "No dishes yet"}
                                </span>
                                {dayFigures(entry).map((figure) => (
                                  <span key={figure} className="block tabular-nums text-ink/70">
                                    {figure}
                                  </span>
                                ))}
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
    </div>
  );
}

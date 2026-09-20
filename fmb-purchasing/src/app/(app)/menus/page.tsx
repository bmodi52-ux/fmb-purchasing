import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildMonthGrid, formatHijri } from "@/lib/hijri/hijri";
import { costMenuDay } from "@/lib/menu-costing";
import { loadDishes, loadItemPrices, loadKitchens } from "./data";

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
  searchParams: Promise<{ month?: string; kitchen?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "view");

  const { month: monthParam, kitchen: kitchenParam } = await searchParams;
  const admin = createAdminClient();

  const kitchens = await loadKitchens(admin);
  const kitchen = kitchens.find((k) => k.id === kitchenParam) ?? kitchens[0];

  const today = new Date();
  const [yearStr, monthStr] = (monthParam ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`)
    .split("-");
  const year = Number(yearStr) || today.getFullYear();
  const month = Math.min(12, Math.max(1, Number(monthStr) || today.getMonth() + 1));

  const weeks = buildMonthGrid(year, month);
  const from = isoDate(weeks[0][0].gregorian);
  const to = isoDate(weeks[weeks.length - 1][6].gregorian);

  const { data: days } = kitchen
    ? await admin
        .from("menu_days")
        .select("id, service_date, planned_thaalis, confirmed_thaalis, status, menu_day_dishes ( dish_id, sort_order )")
        .eq("kitchen_id", kitchen.id)
        .gte("service_date", from)
        .lte("service_date", to)
        .order("service_date")
    : { data: [] };

  // One read of every dish and price on the screen, rather than one per day.
  const dishIds = [
    ...new Set((days ?? []).flatMap((d) => (d.menu_day_dishes ?? []).map((x) => x.dish_id as string))),
  ];
  const dishes = await loadDishes(admin, dishIds);
  const dishById = new Map(dishes.map((d) => [d.dishId, d]));
  const prices = await loadItemPrices(admin, [...new Set(dishes.flatMap((d) => d.ingredients.map((i) => i.itemId)))]);

  const byDate = new Map(
    (days ?? []).map((d) => {
      const onDay = [...(d.menu_day_dishes ?? [])]
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
        .flatMap((x) => dishById.get(x.dish_id as string) ?? []);
      const thaalis = Number(d.confirmed_thaalis ?? d.planned_thaalis);
      return [
        d.service_date as string,
        { ...d, dishes: onDay, cost: onDay.length > 0 ? costMenuDay(onDay, thaalis, prices) : null, thaalis },
      ];
    })
  );

  const monthHref = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    const target = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return `/menus?month=${target}${kitchen ? `&kitchen=${kitchen.id}` : ""}`;
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

      {kitchens.length > 1 && (
        <nav aria-label="Kitchen" className="flex flex-wrap gap-1 border-b border-ink/10">
          {kitchens.map((k) => (
            <Link
              key={k.id}
              href={`/menus?month=${year}-${String(month).padStart(2, "0")}&kitchen=${k.id}`}
              aria-current={k.id === kitchen?.id ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${
                k.id === kitchen?.id
                  ? "border-gold-deep font-medium text-ink"
                  : "border-transparent text-ink/60 hover:text-ink"
              }`}
            >
              {k.name}
            </Link>
          ))}
        </nav>
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
            href={`/menus${kitchen ? `?kitchen=${kitchen.id}` : ""}`}
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
          .map(([date, day]) => (
            <li key={date}>
              <Link
                href={`/menus/${date}${kitchen ? `?kitchen=${kitchen.id}` : ""}`}
                className="flex flex-col gap-1 rounded-lg border border-ink/10 bg-white/70 p-3"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-ink">{new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span className="text-xs text-ink/50">{day.thaalis} thaalis</span>
                </span>
                <span className="text-sm text-ink/70">{day.dishes.map((d) => d.dishName).join(", ") || "No dishes yet"}</span>
                {day.cost?.perThaali != null && (
                  <span className="font-mono text-xs text-ink/55">{money(day.cost.perThaali)} a thaali</span>
                )}
              </Link>
            </li>
          ))}
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
                  const day = byDate.get(date);
                  const isToday = date === isoDate(today);
                  return (
                    <td key={date} className="align-top">
                      <Link
                        href={`/menus/${date}${kitchen ? `?kitchen=${kitchen.id}` : ""}`}
                        className={`flex h-32 flex-col gap-1 rounded-md border p-2 text-xs transition-colors ${
                          cell.inCurrentMonth ? "bg-white/70" : "bg-ink/[0.02] text-ink/40"
                        } ${isToday ? "border-gold-deep" : "border-ink/10"} hover:border-ink/30`}
                      >
                        <span className="flex items-baseline justify-between gap-1">
                          <span className={`font-medium ${cell.inCurrentMonth ? "text-ink" : ""}`}>
                            {cell.gregorian.getDate()}
                          </span>
                          <span className="text-[0.65rem] text-ink/45">{formatHijri(cell.hijri)}</span>
                        </span>
                        {day && (
                          <>
                            <span className="line-clamp-3 text-ink/75">
                              {day.dishes.map((d) => d.dishName).join(", ")}
                            </span>
                            <span className="mt-auto text-ink/50">
                              {day.thaalis > 0 && `${day.thaalis} thaalis`}
                              {day.cost?.perThaali != null && (
                                <span className="block font-mono text-ink/70">{money(day.cost.perThaali)}/thaali</span>
                              )}
                            </span>
                          </>
                        )}
                      </Link>
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

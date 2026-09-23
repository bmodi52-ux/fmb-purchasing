import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlainDate } from "@/lib/format";
import { todayIso } from "@/lib/periods-data";
import { SECTION_LABEL, type SectionKey } from "@/lib/menu-sections";
import { progressOf } from "@/lib/procurement";
import { boxesFor, costMenuDay } from "@/lib/menu-costing";
import { dayCostRows, sectionTotals, totalsOf, type CostDay } from "@/lib/thaali-costs";
import { loadDishes, loadItemPrices, loadKitchens, withDayCounts } from "../data";
import { MenuTabs } from "../tabs";

export const metadata = { title: "Thaali Calendar · Costs" };

const money = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

const isDate = (v: string | undefined): v is string => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");

function monthsBack(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1)).toISOString().slice(0, 10);
}

type RequirementRow = {
  id: string;
  section: SectionKey;
  quantity: number | string;
  planned_cost: number | string | null;
};

/**
 * What the thaali has cost over a stretch of days (#15): per day, per
 * section, and per dish.
 *
 * Per day and per section come from released days — what they were planned
 * at, and what receipts allocated back to them came to. Per dish is worked
 * out from the recipes at today's prices, because nothing records what one
 * dish on a day cost once the day is bought as a whole.
 */
export default async function ThaaliCostsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; kitchen?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await requirePermission(user, "menus", "view");

  const params = await searchParams;
  const today = todayIso();
  const from = isDate(params.from) ? params.from : monthsBack(today, 2);
  const to = isDate(params.to) && params.to >= from ? params.to : today;

  const admin = createAdminClient();
  const kitchens = await loadKitchens(admin);
  const kitchenIds = kitchens.some((k) => k.id === params.kitchen) ? [params.kitchen!] : kitchens.map((k) => k.id);
  const kitchenName = new Map(kitchens.map((k) => [k.id, k.name]));

  const { data: days } = await admin
    .from("menu_days")
    .select(
      "id, kitchen_id, service_date, status, planned_thaalis, confirmed_thaalis, menu_day_dishes ( dish_id, boxes_offered, expected_boxes )"
    )
    .in("kitchen_id", kitchenIds)
    .gte("service_date", from)
    .lte("service_date", to)
    .order("service_date");

  const released = (days ?? []).filter((d) => d.status === "released");
  const { data: requirements } = released.length
    ? await admin
        .from("menu_requirements")
        .select("id, menu_day_id, section, quantity, planned_cost")
        .in(
          "menu_day_id",
          released.map((d) => d.id as string)
        )
        .neq("status", "cancelled")
    : { data: [] };
  const reqIds = (requirements ?? []).map((r) => r.id as string);
  const { data: allocations } = reqIds.length
    ? await admin.from("expense_line_allocations").select("menu_requirement_id, quantity, amount").in("menu_requirement_id", reqIds)
    : { data: [] };

  const allocationsBy = new Map<string, { quantity: number; amount: number }[]>();
  for (const a of allocations ?? []) {
    const key = a.menu_requirement_id as string;
    allocationsBy.set(key, [...(allocationsBy.get(key) ?? []), { quantity: Number(a.quantity), amount: Number(a.amount) }]);
  }
  const reqsBy = new Map<string, RequirementRow[]>();
  for (const r of requirements ?? []) {
    const key = r.menu_day_id as string;
    reqsBy.set(key, [...(reqsBy.get(key) ?? []), r as unknown as RequirementRow]);
  }

  const thaalisOf = (d: { planned_thaalis: unknown; confirmed_thaalis: unknown }) =>
    Number(d.confirmed_thaalis ?? d.planned_thaalis ?? 0);

  const costDays: CostDay[] = released.map((d) => ({
    date: d.service_date as string,
    kitchenId: d.kitchen_id as string,
    kitchenName: kitchenName.get(d.kitchen_id as string) ?? "",
    thaalis: thaalisOf(d),
    requirements: (reqsBy.get(d.id as string) ?? []).map((r) => {
      const progress = progressOf({ quantity: Number(r.quantity) }, allocationsBy.get(r.id) ?? []);
      return {
        section: r.section,
        plannedCost: r.planned_cost == null ? null : Number(r.planned_cost),
        spent: progress.spent,
        complete: progress.complete,
      };
    }),
  }));
  const rows = dayCostRows(costDays);
  const totals = totalsOf(rows);
  const sections = sectionTotals(costDays);

  // Per dish, from the recipes at today's prices, over every day it was on.
  const dishRows = (days ?? []).flatMap((d) =>
    (d.menu_day_dishes ?? []).map((x) => ({ day: d, row: x as { dish_id: string; boxes_offered?: number | string | null; expected_boxes?: number | null } }))
  );
  const dishes = await loadDishes(admin, [...new Set(dishRows.map((x) => x.row.dish_id))]);
  const prices = await loadItemPrices(admin, [...new Set(dishes.flatMap((d) => d.ingredients.map((i) => i.itemId)))]);
  const dishById = new Map(dishes.map((d) => [d.dishId, d]));
  const byDish = new Map<string, { name: string; days: number; boxes: number; cost: number; unpriced: boolean }>();
  for (const { day, row } of dishRows) {
    const base = dishById.get(row.dish_id);
    if (!base) continue;
    const [dish] = withDayCounts([base], [row]);
    const thaalis = thaalisOf(day);
    const cost = costMenuDay({ dishes: [dish] }, thaalis, prices);
    const entry = byDish.get(dish.dishId) ?? { name: dish.dishName, days: 0, boxes: 0, cost: 0, unpriced: false };
    entry.days += 1;
    entry.boxes += boxesFor(dish, thaalis);
    entry.cost += cost.total;
    entry.unpriced ||= cost.unpriced > 0;
    byDish.set(dish.dishId, entry);
  }
  const dishTable = [...byDish.values()].sort((a, b) => b.cost - a.cost);

  const query = (next: Record<string, string>) =>
    `/menus/costs?${new URLSearchParams({ from, to, ...(params.kitchen ? { kitchen: params.kitchen } : {}), ...next }).toString()}`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="page-title text-ink">Thaali Calendar</h1>
        <p className="page-description mt-1 max-w-2xl">
          What the thaali has cost: planned, from the prices frozen when each day was released, and actual, from the
          receipts allocated back to it.
        </p>
      </div>

      <MenuTabs active="costs" />

      <form action="/menus/costs" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-ink/70">From</span>
          <input type="date" name="from" defaultValue={from} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink/70">To</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        {kitchens.length > 1 && (
          <label className="flex flex-col gap-1">
            <span className="text-ink/70">Kitchen</span>
            <select name="kitchen" defaultValue={params.kitchen ?? ""} className="input">
              <option value="">Both kitchens</option>
              {kitchens.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="btn btn-secondary">
          Show
        </button>
        <Link href={query({ from: monthsBack(today, 0), to: today })} className="px-1 py-2 text-ink/60 underline-offset-2 hover:underline">
          This month
        </Link>
      </form>

      <section className="grid gap-3 sm:grid-cols-4">
        <Figure label="Released days" value={String(totals.days)} note={`${totals.thaalis.toLocaleString("en-AU")} thaalis`} />
        <Figure label="Planned" value={money(totals.planned)} note={`${money(totals.plannedPerThaali)} a thaali`} />
        <Figure label="Spent so far" value={money(totals.actual)} note="from receipts allocated to days" />
        <Figure
          label="Actual a thaali"
          value={money(totals.actualPerThaali)}
          note={`over the ${totals.fullyBoughtDays} ${totals.fullyBoughtDays === 1 ? "day" : "days"} bought for in full`}
        />
      </section>

      <section className="card p-5">
        <h2 className="mb-3 section-title text-ink">By day</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-ink/55">No released days between these dates.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink/50">
                  <th scope="col" className="p-2">Day</th>
                  <th scope="col" className="p-2">Kitchen</th>
                  <th scope="col" className="p-2 text-right">Thaalis</th>
                  <th scope="col" className="p-2 text-right">Planned</th>
                  <th scope="col" className="p-2 text-right">A thaali</th>
                  <th scope="col" className="p-2 text-right">Spent</th>
                  <th scope="col" className="p-2 text-right">A thaali</th>
                  <th scope="col" className="p-2">Bought</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.date}-${r.kitchenName}-${i}`} className="border-t border-ink/5">
                    <td className="p-2 whitespace-nowrap">
                      <Link
                        href={`/menus/${r.date}?kitchen=${costDays[i].kitchenId}`}
                        className="text-ink underline-offset-2 hover:underline"
                      >
                        {formatPlainDate(r.date)}
                      </Link>
                    </td>
                    <td className="p-2 text-ink/70">{r.kitchenName}</td>
                    <td className="p-2 text-right tabular-nums">{r.thaalis}</td>
                    <td className="p-2 text-right tabular-nums">{money(r.planned)}</td>
                    <td className="p-2 text-right tabular-nums text-ink/70">{money(r.plannedPerThaali)}</td>
                    <td className="p-2 text-right tabular-nums">{r.actual > 0 ? money(r.actual) : "—"}</td>
                    <td
                      className={`p-2 text-right tabular-nums ${
                        r.stillToBuy === 0 && r.actualPerThaali != null && r.plannedPerThaali != null
                          ? r.actualPerThaali > r.plannedPerThaali
                            ? "text-alert"
                            : "text-palm"
                          : "text-ink/45"
                      }`}
                    >
                      {r.actual > 0 ? money(r.actualPerThaali) : "—"}
                    </td>
                    <td className="p-2 text-xs text-ink/55">
                      {r.stillToBuy === 0 ? "all of it" : `${r.stillToBuy} still to buy`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {sections.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 section-title text-ink">By section</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink/50">
                  <th scope="col" className="p-2">Section</th>
                  <th scope="col" className="p-2 text-right">Planned</th>
                  <th scope="col" className="p-2 text-right">A thaali</th>
                  <th scope="col" className="p-2 text-right">Spent so far</th>
                  <th scope="col" className="p-2 text-right">Share of planned</th>
                </tr>
              </thead>
              <tbody>
                {sections.map((s) => (
                  <tr key={s.section} className="border-t border-ink/5">
                    <td className="p-2 text-ink">{SECTION_LABEL[s.section]}</td>
                    <td className="p-2 text-right tabular-nums">{money(s.planned)}</td>
                    <td className="p-2 text-right tabular-nums text-ink/70">{money(s.plannedPerThaali)}</td>
                    <td className="p-2 text-right tabular-nums">{money(s.actual)}</td>
                    <td className="p-2 text-right tabular-nums text-ink/70">
                      {totals.planned > 0 ? `${Math.round((s.planned / totals.planned) * 100)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card p-5">
        <h2 className="mb-1 section-title text-ink">By dish</h2>
        <p className="mb-3 text-sm text-ink/55">
          Every day each dish was on, released or not, worked out from its recipe at today&apos;s prices.
        </p>
        {dishTable.length === 0 ? (
          <p className="text-sm text-ink/55">No dishes on the menu between these dates.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink/50">
                  <th scope="col" className="p-2">Dish</th>
                  <th scope="col" className="p-2 text-right">Days</th>
                  <th scope="col" className="p-2 text-right">Boxes</th>
                  <th scope="col" className="p-2 text-right">Cost</th>
                  <th scope="col" className="p-2 text-right">A box</th>
                </tr>
              </thead>
              <tbody>
                {dishTable.map((d) => (
                  <tr key={d.name} className="border-t border-ink/5">
                    <td className="p-2 text-ink">
                      {d.name}
                      {d.unpriced && <span className="ml-2 text-xs text-alert">some items have no price</span>}
                    </td>
                    <td className="p-2 text-right tabular-nums">{d.days}</td>
                    <td className="p-2 text-right tabular-nums">{d.boxes.toLocaleString("en-AU")}</td>
                    <td className="p-2 text-right tabular-nums">{money(d.cost)}</td>
                    <td className="p-2 text-right tabular-nums text-ink/70">{d.boxes > 0 ? money(d.cost / d.boxes) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-ink/55">{label}</p>
      <p className="mt-1 tabular-nums text-xl text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink/50">{note}</p>
    </div>
  );
}

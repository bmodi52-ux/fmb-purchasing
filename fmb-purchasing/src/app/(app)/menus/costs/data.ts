import type { SupabaseClient } from "@supabase/supabase-js";
import { liveAllocations } from "@/lib/live-allocations";
import { SECTION_LABEL, type SectionKey } from "@/lib/menu-sections";
import { boxesFor, costMenuDay } from "@/lib/menu-costing";
import { parsePeriod, rangeCode, type Period } from "@/lib/periods";
import { progressOf } from "@/lib/procurement";
import type { ReportTable } from "@/lib/reporting/tables";
import {
  dayCostRows,
  sectionTotals,
  totalsOf,
  type CostDay,
  type DayCostRow,
  type SectionTotal,
  type Totals,
} from "@/lib/thaali-costs";
import { loadDishes, loadItemPrices, loadKitchens, withDayCounts, type Kitchen } from "../data";

/**
 * The Thaali costs page's figures, from its URL — shared by the page and its
 * download (reports registry), so a file is always the page it came from.
 */

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDate = (v: string | undefined): v is string => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");

function monthsBack(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1)).toISOString().slice(0, 10);
}

/**
 * The period asked for. The page took `from` and `to` before it had the
 * shared period picker, and links with them still land on those dates; with
 * neither, it opens where it always did, on the last three months.
 */
export function thaaliCostsPeriod(params: Params, today: string): Period {
  const period = one(params.period);
  if (period) return parsePeriod(period, today);
  const from = isDate(one(params.from)) ? one(params.from)! : monthsBack(today, 2);
  const to = isDate(one(params.to)) && one(params.to)! >= from ? one(params.to)! : today;
  return parsePeriod(rangeCode(from, to), today);
}

type RequirementRow = {
  id: string;
  menu_day_id: string;
  section: SectionKey;
  quantity: number | string;
  planned_cost: number | string | null;
};

export type DishCost = { name: string; days: number; boxes: number; cost: number; unpriced: boolean };

export type ThaaliCostsView = {
  period: Period;
  kitchens: Kitchen[];
  /** The kitchen chosen, or null for all of them. */
  kitchenId: string | null;
  costDays: CostDay[];
  rows: DayCostRow[];
  totals: Totals;
  sections: SectionTotal[];
  dishes: DishCost[];
};

export async function loadThaaliCosts(admin: SupabaseClient, params: Params, today: string): Promise<ThaaliCostsView> {
  const period = thaaliCostsPeriod(params, today);
  const kitchens = await loadKitchens(admin);
  const asked = one(params.kitchen);
  const kitchenId = kitchens.some((k) => k.id === asked) ? asked! : null;
  const kitchenIds = kitchenId ? [kitchenId] : kitchens.map((k) => k.id);
  const kitchenName = new Map(kitchens.map((k) => [k.id, k.name]));

  const { data: days } = await admin
    .from("menu_days")
    .select(
      "id, kitchen_id, service_date, status, planned_thaalis, confirmed_thaalis, menu_day_dishes ( dish_id, boxes_offered, expected_boxes )"
    )
    .in("kitchen_id", kitchenIds)
    .gte("service_date", period.start)
    .lte("service_date", period.end)
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
  // Only receipts that still count: a declined one is not money spent on the day.
  const allocations = await liveAllocations(admin, reqIds);

  const allocationsBy = new Map<string, { quantity: number; amount: number }[]>();
  for (const a of allocations) {
    const key = a.menu_requirement_id as string;
    allocationsBy.set(key, [...(allocationsBy.get(key) ?? []), { quantity: Number(a.quantity), amount: Number(a.amount) }]);
  }
  const reqsBy = new Map<string, RequirementRow[]>();
  for (const r of (requirements ?? []) as unknown as RequirementRow[]) {
    reqsBy.set(r.menu_day_id, [...(reqsBy.get(r.menu_day_id) ?? []), r]);
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

  // Per dish, from the recipes at today's prices, over every day it was on.
  const dishRows = (days ?? []).flatMap((d) =>
    (d.menu_day_dishes ?? []).map((x) => ({
      day: d,
      row: x as { dish_id: string; boxes_offered?: number | string | null; expected_boxes?: number | null },
    }))
  );
  const dishes = await loadDishes(admin, [...new Set(dishRows.map((x) => x.row.dish_id))]);
  const prices = await loadItemPrices(admin, [...new Set(dishes.flatMap((d) => d.ingredients.map((i) => i.itemId)))]);
  const dishById = new Map(dishes.map((d) => [d.dishId, d]));
  const byDish = new Map<string, DishCost>();
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

  return {
    period,
    kitchens,
    kitchenId,
    costDays,
    rows,
    totals: totalsOf(rows),
    sections: sectionTotals(costDays),
    dishes: [...byDish.values()].sort((a, b) => b.cost - a.cost),
  };
}

/** The page as tables, for its download: by day, by section, by dish. */
export function thaaliCostTables(view: ThaaliCostsView): ReportTable[] {
  const round = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
  return [
    {
      title: "By day",
      columns: [
        { key: "date", label: "Day", kind: "date" },
        { key: "kitchen", label: "Kitchen", kind: "text" },
        { key: "thaalis", label: "Thaalis", kind: "count" },
        { key: "planned", label: "Planned", kind: "money" },
        { key: "plannedPerThaali", label: "Planned a thaali", kind: "money" },
        { key: "actual", label: "Spent", kind: "money" },
        { key: "actualPerThaali", label: "Spent a thaali", kind: "money" },
        { key: "stillToBuy", label: "Still to buy", kind: "count" },
      ],
      rows: view.rows.map((r) => ({
        date: r.date,
        kitchen: r.kitchenName,
        thaalis: r.thaalis,
        planned: round(r.planned),
        plannedPerThaali: round(r.plannedPerThaali),
        actual: round(r.actual),
        actualPerThaali: r.actual > 0 ? round(r.actualPerThaali) : null,
        stillToBuy: r.stillToBuy,
      })),
      totals: {
        date: "Total",
        thaalis: view.totals.thaalis,
        planned: round(view.totals.planned),
        plannedPerThaali: round(view.totals.plannedPerThaali),
        actual: round(view.totals.actual),
        actualPerThaali: round(view.totals.actualPerThaali),
      },
    },
    {
      title: "By section",
      columns: [
        { key: "section", label: "Section", kind: "text" },
        { key: "planned", label: "Planned", kind: "money" },
        { key: "plannedPerThaali", label: "Planned a thaali", kind: "money" },
        { key: "actual", label: "Spent so far", kind: "money" },
      ],
      rows: view.sections.map((s) => ({
        section: SECTION_LABEL[s.section],
        planned: round(s.planned),
        plannedPerThaali: round(s.plannedPerThaali),
        actual: round(s.actual),
      })),
    },
    {
      title: "By dish",
      columns: [
        { key: "name", label: "Dish", kind: "text" },
        { key: "days", label: "Days", kind: "count" },
        { key: "boxes", label: "Boxes", kind: "number" },
        { key: "cost", label: "Cost at today's prices", kind: "money" },
        { key: "perBox", label: "A box", kind: "money" },
        { key: "unpriced", label: "Some items unpriced", kind: "text" },
      ],
      rows: view.dishes.map((d) => ({
        name: d.name,
        days: d.days,
        boxes: d.boxes,
        cost: round(d.cost),
        perBox: d.boxes > 0 ? round(d.cost / d.boxes) : null,
        unpriced: d.unpriced ? "Yes" : "",
      })),
    },
  ];
}

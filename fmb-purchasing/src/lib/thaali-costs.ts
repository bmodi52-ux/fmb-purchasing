import { round2 } from "@/lib/expense-money";
import type { SectionKey } from "@/lib/menu-sections";

/**
 * What the thaali cost, over a stretch of days (#15, reporting).
 *
 * Two figures for every day, as the day page already gives them: planned,
 * from the prices frozen when the day was released, and actual, from the
 * receipts allocated back to it. Pure, so the sums can be checked against a
 * spreadsheet without a database.
 */

export type CostRequirement = { section: SectionKey; plannedCost: number | null; spent: number; complete: boolean };

export type CostDay = {
  date: string;
  kitchenId: string;
  kitchenName: string;
  thaalis: number;
  requirements: CostRequirement[];
};

export type DayCostRow = {
  date: string;
  kitchenName: string;
  thaalis: number;
  planned: number;
  actual: number;
  plannedPerThaali: number | null;
  actualPerThaali: number | null;
  /** Lines nothing, or not enough, has been bought against yet. */
  stillToBuy: number;
};

const per = (total: number, thaalis: number) => (thaalis > 0 ? round2(total / thaalis) : null);

export function dayCostRows(days: readonly CostDay[]): DayCostRow[] {
  return days.map((d) => {
    const planned = round2(d.requirements.reduce((s, r) => s + (r.plannedCost ?? 0), 0));
    const actual = round2(d.requirements.reduce((s, r) => s + r.spent, 0));
    return {
      date: d.date,
      kitchenName: d.kitchenName,
      thaalis: d.thaalis,
      planned,
      actual,
      plannedPerThaali: per(planned, d.thaalis),
      actualPerThaali: per(actual, d.thaalis),
      stillToBuy: d.requirements.filter((r) => !r.complete).length,
    };
  });
}

export type Totals = {
  days: number;
  thaalis: number;
  planned: number;
  actual: number;
  plannedPerThaali: number | null;
  /** Only over days everything has been bought for, so a half-bought day doesn't pull it down. */
  actualPerThaali: number | null;
  fullyBoughtDays: number;
};

export function totalsOf(rows: readonly DayCostRow[]): Totals {
  const thaalis = rows.reduce((s, r) => s + r.thaalis, 0);
  const planned = round2(rows.reduce((s, r) => s + r.planned, 0));
  const actual = round2(rows.reduce((s, r) => s + r.actual, 0));
  const done = rows.filter((r) => r.stillToBuy === 0 && r.actual > 0);
  const doneThaalis = done.reduce((s, r) => s + r.thaalis, 0);
  return {
    days: rows.length,
    thaalis,
    planned,
    actual,
    plannedPerThaali: per(planned, thaalis),
    actualPerThaali: per(
      done.reduce((s, r) => s + r.actual, 0),
      doneThaalis
    ),
    fullyBoughtDays: done.length,
  };
}

export type SectionTotal = { section: SectionKey; planned: number; actual: number; plannedPerThaali: number | null };

export function sectionTotals(days: readonly CostDay[]): SectionTotal[] {
  const thaalis = days.reduce((s, d) => s + d.thaalis, 0);
  const by = new Map<SectionKey, { planned: number; actual: number }>();
  for (const d of days) {
    for (const r of d.requirements) {
      const t = by.get(r.section) ?? { planned: 0, actual: 0 };
      t.planned += r.plannedCost ?? 0;
      t.actual += r.spent;
      by.set(r.section, t);
    }
  }
  return [...by.entries()].map(([section, t]) => ({
    section,
    planned: round2(t.planned),
    actual: round2(t.actual),
    plannedPerThaali: per(t.planned, thaalis),
  }));
}

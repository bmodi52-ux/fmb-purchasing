/**
 * What the kitchen actually paid per kilo, litre or item, for the Unit costs
 * section, the Compare cards and the home widgets — one module, so the three
 * can't drift apart. Pure, and tested.
 *
 * A purchase whose pack and receipt disagree by five times or more
 * (item_paid_unit_costs.pack_disagrees, 0066) rests on pack contents nobody
 * believes, so its per-unit figure is left out of every trend and average
 * here, exactly as the Pricelist leaves it out of item_unit_costs. It is still
 * listed, marked, so the purchase doesn't vanish; its per-pack price, which
 * doesn't depend on the contents, still shows.
 */

import type { PaidCostRow } from "./data.ts";
import type { Slice } from "./aggregate.ts";
import type { LineSeriesData } from "./charts.tsx";

export type PerUnitRow = {
  groupName: string;
  vendorName: string;
  receiptDate: string | null;
  normalizedQuantity: number;
  normalizedUnit: string;
  perUnit: number;
  /** What one pack — a box, a bag — cost. Null when bought loose, where it is the per-unit figure. */
  perPack: number | null;
  /** The pack's contents and the receipt disagree; perUnit is not to be believed. */
  disputed: boolean;
};

/**
 * One row per purchase in the slice, for the items `keepItem` allows, sorted
 * by item and then date.
 */
export function perUnitRows(
  paidCosts: PaidCostRow[],
  slice: Slice,
  keepItem: (itemId: string) => boolean,
  fallbackName = "—"
): PerUnitRow[] {
  const vendorNameByExpense = new Map(slice.expenses.map((e) => [e.id, e.vendorName]));
  return paidCosts
    .filter((c) => vendorNameByExpense.has(c.expense_id) && keepItem(c.item_id))
    .map((c) => ({
      groupName: c.item_name ?? fallbackName,
      vendorName: vendorNameByExpense.get(c.expense_id) ?? "—",
      receiptDate: c.receipt_date ?? null,
      normalizedQuantity: Number(c.base_quantity),
      normalizedUnit: c.base_unit_code,
      perUnit: Number(c.cost_per_base_unit),
      // A loose line's pack is one unit, so its per-pack price is the per-unit one.
      perPack: c.sold_loose ? null : Number(c.line_total) / Number(c.normalized_quantity),
      // Absent on figures cached before this was read; they count as believed
      // until the cache refreshes, which is what they were before.
      disputed: c.pack_disagrees === true,
    }))
    .sort(
      (a, b) =>
        a.groupName.localeCompare(b.groupName) || (a.receiptDate ?? "").localeCompare(b.receiptDate ?? "")
    );
}

/** One line per vendor for the trend chart: dated, undisputed purchases only. */
export function perUnitVendorSeries(rows: PerUnitRow[]): LineSeriesData[] {
  const byVendorName = new Map<string, PerUnitRow[]>();
  for (const r of rows) {
    if (!r.receiptDate || r.disputed) continue;
    byVendorName.set(r.vendorName, [...(byVendorName.get(r.vendorName) ?? []), r]);
  }
  return [...byVendorName.entries()].map(([name, vendorRows]) => ({
    name,
    points: [...vendorRows]
      .sort((a, b) => (a.receiptDate ?? "").localeCompare(b.receiptDate ?? ""))
      .map((r) => ({ x: r.receiptDate!, y: r.perUnit })),
  }));
}

export type AverageUnitCost = { average: number; unit: string; purchases: number };

/**
 * What an item cost per unit across the slice: everything paid for it divided
 * by everything bought, so a big purchase counts for more than a small one.
 *
 * It used to be the plain mean of each purchase's per-unit price, which lets
 * one 500g top-up at a corner shop pull the figure as hard as a 40kg order.
 * Disputed purchases are left out of both sums. An item bought in more than
 * one base unit — rare — reports the unit it was bought in most often.
 */
export function averageUnitCosts(
  paidCosts: PaidCostRow[],
  slice: Slice,
  keepItem: (itemId: string) => boolean
): Map<string, AverageUnitCost> {
  const inSlice = new Set(slice.expenses.map((e) => e.id));
  const acc = new Map<string, Map<string, { paid: number; quantity: number; purchases: number }>>();

  for (const c of paidCosts) {
    if (!inSlice.has(c.expense_id) || !keepItem(c.item_id) || c.pack_disagrees === true) continue;
    const quantity = Number(c.base_quantity);
    if (!(quantity > 0)) continue;
    const byUnit = acc.get(c.item_id) ?? new Map();
    const entry = byUnit.get(c.base_unit_code) ?? { paid: 0, quantity: 0, purchases: 0 };
    entry.paid += Number(c.line_total);
    entry.quantity += quantity;
    entry.purchases += 1;
    byUnit.set(c.base_unit_code, entry);
    acc.set(c.item_id, byUnit);
  }

  const out = new Map<string, AverageUnitCost>();
  for (const [itemId, byUnit] of acc) {
    const [unit, entry] = [...byUnit.entries()].sort((a, b) => b[1].purchases - a[1].purchases)[0];
    out.set(itemId, { average: entry.paid / entry.quantity, unit, purchases: entry.purchases });
  }
  return out;
}

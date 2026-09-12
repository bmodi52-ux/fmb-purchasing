import { formatUnitCost } from "@/lib/pack-description";

/**
 * Price alerts and unusual spend (scratchpad #29, #42) — the judgements, with
 * no database in sight so they can be tested directly. price-alerts-data.ts
 * loads what these need.
 *
 * A price is compared per kg, litre or each, never per pack: a 10 kg bag and a
 * 25 kg sack of the same rice are the same price if they cost the same per kg.
 * So a purchase whose pack contents nobody has confirmed — its "per unit" is
 * really per pack — is never judged, and neither is one compared against it.
 */

export type PriceLimitSource = {
  price_rise_percent: number | string | null;
  price_fall_percent: number | string | null;
};

export type ItemPriceSettings = PriceLimitSource & {
  expected_min_per_unit: number | string | null;
  expected_max_per_unit: number | string | null;
};

export type PriceLimits = {
  /** Percent above the last purchase that is flagged. */
  rise: number;
  /** Percent below the last purchase that is flagged. */
  fall: number;
  rangeMin: number | null;
  rangeMax: number | null;
  /** Where the percentages came from, for saying so on the item page. */
  riseFrom: "item" | "category" | "pricelist";
  fallFrom: "item" | "category" | "pricelist";
};

const numberOrNull = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The item's own limit, else its category's, else the Pricelist's. */
export function limitsFor(
  pricelist: { risePercent: number; fallPercent: number },
  category: PriceLimitSource | null,
  item: ItemPriceSettings | null
): PriceLimits {
  const pick = (key: "price_rise_percent" | "price_fall_percent", fallback: number) => {
    const own = numberOrNull(item?.[key]);
    if (own != null && own > 0) return { value: own, from: "item" as const };
    const inherited = numberOrNull(category?.[key]);
    if (inherited != null && inherited > 0) return { value: inherited, from: "category" as const };
    return { value: fallback, from: "pricelist" as const };
  };
  const rise = pick("price_rise_percent", pricelist.risePercent);
  const fall = pick("price_fall_percent", pricelist.fallPercent);
  return {
    rise: rise.value,
    fall: fall.value,
    riseFrom: rise.from,
    fallFrom: fall.from,
    rangeMin: numberOrNull(item?.expected_min_per_unit),
    rangeMax: numberOrNull(item?.expected_max_per_unit),
  };
}

/** One purchase of an item, per base unit, as item_paid_unit_costs has it. */
export type PricePoint = {
  lineId: string;
  expenseId: string;
  itemId: string;
  vendorId: string | null;
  /** The receipt date, or the day it was submitted when there is none. */
  date: string;
  submittedAt: string;
  costPerUnit: number;
  unit: string;
  confirmed: boolean;
};

/**
 * The purchase of the same item just before this one — by receipt date, then
 * by when it was submitted — from any vendor, on another expense, in the same
 * unit, with its pack contents confirmed.
 */
export function previousPurchase(point: PricePoint, history: PricePoint[]): PricePoint | null {
  let best: PricePoint | null = null;
  for (const h of history) {
    if (h.itemId !== point.itemId || h.expenseId === point.expenseId) continue;
    if (!h.confirmed || h.unit !== point.unit) continue;
    const earlier = h.date < point.date || (h.date === point.date && h.submittedAt < point.submittedAt);
    if (!earlier) continue;
    if (!best || h.date > best.date || (h.date === best.date && h.submittedAt > best.submittedAt)) best = h;
  }
  return best;
}

export type PriceFlag =
  | {
      kind: "rise" | "fall";
      lineId: string;
      itemId: string;
      itemName: string;
      from: number;
      to: number;
      /** Whole percent moved, always positive. */
      percent: number;
      limit: number;
      unit: string;
      previousDate: string;
      previousVendorId: string | null;
    }
  | {
      kind: "above_range" | "below_range";
      lineId: string;
      itemId: string;
      itemName: string;
      to: number;
      rangeMin: number | null;
      rangeMax: number | null;
      unit: string;
    };

/** Whether a purchase is outside its item's expected range or moved past a limit. */
export function priceFlagsFor(
  point: PricePoint,
  previous: PricePoint | null,
  limits: PriceLimits,
  itemName: string
): PriceFlag[] {
  if (!point.confirmed || !(point.costPerUnit > 0)) return [];
  const flags: PriceFlag[] = [];
  const base = { lineId: point.lineId, itemId: point.itemId, itemName, to: point.costPerUnit, unit: point.unit };

  // Cents matter at the edge: $8.00 against a top of $8.00 is inside.
  const cents = (n: number) => Math.round(n * 100);
  if (limits.rangeMax != null && cents(point.costPerUnit) > cents(limits.rangeMax)) {
    flags.push({ kind: "above_range", ...base, rangeMin: limits.rangeMin, rangeMax: limits.rangeMax });
  } else if (limits.rangeMin != null && cents(point.costPerUnit) < cents(limits.rangeMin)) {
    flags.push({ kind: "below_range", ...base, rangeMin: limits.rangeMin, rangeMax: limits.rangeMax });
  }

  if (previous && previous.costPerUnit > 0) {
    const change = ((point.costPerUnit - previous.costPerUnit) / previous.costPerUnit) * 100;
    // Rounded before comparing, so a limit of 10% is not tripped by 10.004%.
    const moved = Math.round(Math.abs(change) * 10) / 10;
    const kind = change > 0 && moved > limits.rise ? "rise" : change < 0 && moved > limits.fall ? "fall" : null;
    if (kind) {
      flags.push({
        kind,
        ...base,
        from: previous.costPerUnit,
        percent: Math.round(Math.abs(change)),
        limit: kind === "rise" ? limits.rise : limits.fall,
        previousDate: previous.date,
        previousVendorId: previous.vendorId,
      });
    }
  }
  return flags;
}

const perUnit = (n: number, unit: string) => formatUnitCost(n, unit, { decimals: 2 });

/** "Chicken Thigh up 18% on the last purchase: $7.20/kg → $8.50/kg". */
export function describePriceFlag(flag: PriceFlag): string {
  if (!("rangeMax" in flag)) {
    return `${flag.itemName} ${flag.kind === "rise" ? "up" : "down"} ${flag.percent}% on the last purchase: ${perUnit(flag.from, flag.unit)} → ${perUnit(flag.to, flag.unit)}`;
  }
  const range =
    flag.rangeMin != null && flag.rangeMax != null
      ? `${perUnit(flag.rangeMin, flag.unit)}–${perUnit(flag.rangeMax, flag.unit)}`
      : flag.rangeMax != null
        ? `up to ${perUnit(flag.rangeMax, flag.unit)}`
        : `from ${perUnit(flag.rangeMin!, flag.unit)}`;
  return `${flag.itemName} at ${perUnit(flag.to, flag.unit)}, ${flag.kind === "above_range" ? "above" : "below"} the expected ${range}`;
}

/** A rise, or a price above what is expected, is worth stopping for; a fall is worth knowing. */
export function isSeriousPriceFlag(flag: PriceFlag): boolean {
  return flag.kind === "rise" || flag.kind === "above_range";
}

export type UnusualSpend = {
  /** How many times the usual expense this one is, to one decimal place. */
  multiple: number;
  /** The median of the vendor's expenses in the year before. */
  typical: number;
  historyCount: number;
};

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Whether an expense is well above what this vendor usually costs: at least
 * `spendMultiple` times the median of its expenses in the year before, once
 * there are enough of them for "usual" to mean something. The median rather
 * than the average, so one big event order doesn't make every later one look
 * normal.
 */
export function unusualSpend(
  total: number,
  history: number[],
  settings: { spendMultiple: number; spendMinHistory: number }
): UnusualSpend | null {
  if (history.length < Math.max(1, settings.spendMinHistory)) return null;
  const typical = median(history);
  if (!(typical > 0) || !(total > 0)) return null;
  const multiple = total / typical;
  if (multiple < settings.spendMultiple) return null;
  return { multiple: Math.round(multiple * 10) / 10, typical, historyCount: history.length };
}

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

/** "3.4× this vendor's usual expense (about $120)". */
export function describeUnusualSpend(u: UnusualSpend): string {
  return `${u.multiple}× this vendor's usual expense (about ${money(u.typical)})`;
}

export type ExpenseForSpend = {
  id: string;
  vendor_id: string | null;
  total: number | string;
  receipt_date: string | null;
  created_at: string;
};

export const expenseDay = (e: { receipt_date: string | null; created_at: string }) =>
  e.receipt_date ?? e.created_at.slice(0, 10);

/** The same vendor's other expenses dated in the 365 days up to this one. */
export function spendHistoryFor(expense: ExpenseForSpend, others: ExpenseForSpend[]): number[] {
  if (!expense.vendor_id) return [];
  const day = expenseDay(expense);
  const from = new Date(`${day}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 365);
  const since = from.toISOString().slice(0, 10);
  return others
    .filter((o) => o.id !== expense.id && o.vendor_id === expense.vendor_id)
    .filter((o) => {
      const d = expenseDay(o);
      return d >= since && d <= day;
    })
    .map((o) => Number(o.total));
}

export type CheapestSource = { costPerUnit: number; unit: string; vendorId: string | null; date: string };

/**
 * Per item, the lowest price paid per unit since a date, and who charged it —
 * the Pricelist's "cheapest recent source". Unconfirmed packs are left out,
 * since their figure is per pack.
 */
export function cheapestRecent(points: PricePoint[], since: string): Map<string, CheapestSource> {
  const best = new Map<string, CheapestSource>();
  for (const p of points) {
    if (!p.confirmed || p.date < since || !(p.costPerUnit > 0)) continue;
    const current = best.get(p.itemId);
    if (current && current.unit !== p.unit) continue;
    if (!current || p.costPerUnit < current.costPerUnit || (p.costPerUnit === current.costPerUnit && p.date > current.date)) {
      best.set(p.itemId, { costPerUnit: p.costPerUnit, unit: p.unit, vendorId: p.vendorId, date: p.date });
    }
  }
  return best;
}

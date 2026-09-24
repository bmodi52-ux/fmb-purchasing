import { round2 } from "@/lib/expense-money";

/**
 * What a day's menu needs, and what it costs (#70, first piece).
 *
 * The sheet this replaces can say "Goat 120kg" but not why it is 120, so
 * nothing in it moves when the count does. Here a dish states what it takes,
 * the day states how many thaalis are expected, and the quantity falls out of
 * the two — as does the cost, from prices the app already holds.
 *
 * Pure arithmetic over plain values, like expense-money.ts and for the same
 * reason: it is the part someone will check against a spreadsheet.
 */

export type RecipeBasis = "batch" | "box";

/**
 * The sizes to offer when a dish says what it is portioned into.
 *
 * Which sizes the kitchen fills is the kitchen's business and changes, so the
 * list is held in `box_sizes` rather than here. A dish keeps whatever size it
 * was given even after that size is taken off the list, which is why the one
 * in hand is always among the options: editing a dish must never quietly
 * repackage it.
 */
export function boxSizeOptions(offered: readonly number[], current?: number | null): number[] {
  const sizes = new Set(offered.filter((ml) => ml > 0));
  if (current != null && current > 0) sizes.add(current);
  if (sizes.size === 0) sizes.add(1000);
  return [...sizes].sort((a, b) => b - a);
}

export function portionLabel(ml: number): string {
  return ml >= 1000 && ml % 1000 === 0 ? `${ml / 1000} L box` : `${ml} ml box`;
}

export type RecipeLine = {
  itemId: string;
  itemName: string;
  /** Per batch, or per thaali, as the dish says. */
  quantity: number;
  /** The unit the recipe is written in, and what it is in base units. */
  unitCode: string;
  unitToBase: number;
  baseUnitCode: string;
};

export type MenuDish = {
  dishId: string;
  dishName: string;
  basis: RecipeBasis;
  /** The box this dish is portioned into, in millilitres. */
  portionMl: number;
  /** How many boxes one batch fills. Null on a per-box recipe. */
  batchBoxes: number | null;
  /**
   * How many boxes of this dish a thaali may take (#76). Biryani offered as
   * "2 × 1 L" is two; most things are one.
   */
  boxesOffered?: number;
  /**
   * How many boxes to fill. Null means nobody has said yet, and the day
   * assumes everybody takes everything it offers — the conservative reading,
   * and the one that stops a list going short.
   */
  expectedBoxes?: number | null;
  ingredients: RecipeLine[];
};

/**
 * A part of a thaali that is not a dish: roti, fruit, anything bought as it
 * is rather than cooked (#76).
 *
 * How much goes in a thaali is the menu's decision — a day of half a roti is
 * half a roti for everyone who takes one — so only the number of takers
 * varies, and the quantity to buy is the one multiplied by the other.
 */
export type MenuExtra = {
  extraId: string;
  kind: "roti" | "fruit" | "other";
  itemId: string;
  itemName: string;
  /** In the unit the quantity is written in: one roti, half a roti, a piece of fruit. */
  perThaali: number;
  /** How many people take it. Null means nobody has said, so the day's count stands. */
  expectedCount?: number | null;
  unitCode: string;
  unitToBase: number;
  baseUnitCode: string;
};

/**
 * How many boxes of a dish the day has to fill (#76).
 *
 * The day's planned count is only the starting point: what is cooked is the
 * number against the line, because people take part of a thaali and a dish
 * offered as two boxes is not one box each.
 */
export function boxesFor(dish: Pick<MenuDish, "boxesOffered" | "expectedBoxes">, thaalis: number): number {
  if (dish.expectedBoxes != null) return Math.max(0, dish.expectedBoxes);
  return Math.max(0, thaalis) * (dish.boxesOffered ?? 1);
}

/** The same question for a part that is not a dish. */
export function countFor(extra: Pick<MenuExtra, "expectedCount">, thaalis: number): number {
  return Math.max(0, extra.expectedCount ?? thaalis);
}

/**
 * How many times over a recipe is made, for a number of boxes to fill.
 *
 * A per-box recipe scales to them one for one; a batch recipe scales by the
 * share of a batch needed, and it is allowed to be a fraction — the kitchen
 * scales a recipe down rather than cooking a whole pot it does not need, so
 * 250 boxes from a batch of 200 is 1.25 batches, not two.
 */
export function batchesFor(dish: Pick<MenuDish, "basis" | "batchBoxes">, boxes: number): number {
  if (boxes <= 0) return 0;
  if (dish.basis === "box") return boxes;
  const size = dish.batchBoxes ?? 0;
  if (size <= 0) return 0;
  return Math.round((boxes / size) * 1000) / 1000;
}

/**
 * A quantity typed straight in, for a day planned the way the sheet plans it
 * (#77): "Goat 120 kg" under the Meat heading, with nothing said about which
 * dish it is for.
 */
export type MenuLine = {
  lineId: string;
  itemId: string;
  itemName: string;
  quantity: number;
  unitCode: string;
  unitToBase: number;
  baseUnitCode: string;
  /** The heading it was typed under, when that is not the item's own. */
  section?: string | null;
};

/** Everything a day holds, however it was planned. */
export type MenuContents = {
  dishes?: MenuDish[];
  extras?: MenuExtra[];
  lines?: MenuLine[];
};

export type RequirementLine = {
  itemId: string;
  itemName: string;
  /** In the item's base unit — kg, L, ea — which is what prices are per. */
  quantity: number;
  baseUnitCode: string;
  /** Which parts of the menu asked for it, for a day that needs onions three times over. */
  fromDishes: string[];
};

/**
 * Everything a day needs, one line per item.
 *
 * Summed in base units rather than in the units each recipe happens to be
 * written in: two recipes asking for 500 g and 2 kg of yoghurt are one line
 * of 2.5 kg, and the shopping list that follows is a list of things to buy
 * rather than a list of recipe lines.
 */
export function requirementsFor(menu: MenuContents, thaalis: number): RequirementLine[] {
  const dishes = menu.dishes ?? [];
  const extras = menu.extras ?? [];
  const lines = menu.lines ?? [];
  const byItem = new Map<string, RequirementLine>();

  const add = (line: { itemId: string; itemName: string; baseUnitCode: string }, quantity: number, from: string) => {
    const existing = byItem.get(line.itemId);
    if (existing) {
      existing.quantity = round3(existing.quantity + quantity);
      if (!existing.fromDishes.includes(from)) existing.fromDishes.push(from);
    } else {
      byItem.set(line.itemId, {
        itemId: line.itemId,
        itemName: line.itemName,
        quantity: round3(quantity),
        baseUnitCode: line.baseUnitCode,
        fromDishes: [from],
      });
    }
  };

  for (const dish of dishes) {
    const scale = batchesFor(dish, boxesFor(dish, thaalis));
    if (scale <= 0) continue;

    for (const line of dish.ingredients) {
      add(line, line.quantity * scale * line.unitToBase, dish.dishName);
    }
  }

  // Roti and fruit are bought as they are: how much a thaali gets, times how
  // many take it.
  for (const extra of extras) {
    const count = countFor(extra, thaalis);
    if (count <= 0) continue;
    add(extra, extra.perThaali * count * extra.unitToBase, extra.itemName);
  }

  // A typed quantity is already the answer: it says what to buy, not what a
  // recipe implies. It is converted to base units and added like the rest, so
  // a day planned both ways still has one line per item to buy.
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    add(line, line.quantity * line.unitToBase, "typed in");
  }

  return [...byItem.values()].sort((a, b) => a.itemName.localeCompare(b.itemName, "en", { sensitivity: "base" }));
}

/**
 * Where a price came from.
 *
 * Since #29 the cheapest price available wins — paid or quoted, from any
 * store — because collecting prices from several stores is for buying at the
 * cheapest (decided 2026-09-24). The answer says which it used and where from,
 * so a figure nobody can explain is impossible. The older order (last paid,
 * then cheapest paid lately, then a quote) is kept for a caller that hands in
 * only those.
 */
export type PriceBasis =
  | "cheapest_paid"
  | "cheapest_quoted"
  | "paid_latest"
  | "paid_cheapest_recent"
  | "offer"
  | "none";

export const PRICE_BASIS_LABEL: Record<PriceBasis, string> = {
  cheapest_paid: "cheapest, paid",
  cheapest_quoted: "cheapest, quoted",
  paid_latest: "last paid",
  paid_cheapest_recent: "cheapest paid lately",
  offer: "vendor's quoted price",
  none: "no price yet",
};

/** One price an item could be costed at: a store's offer, or what was last paid there. */
export type PriceCandidate = {
  perUnit: number;
  source: "paid" | "quoted";
  vendorName: string | null;
  /** When it was paid or read, YYYY-MM-DD. Prices never expire; the date is shown. */
  date: string | null;
  brand: string | null;
};

/**
 * The cheapest candidate. An item with a preferred brand is costed at that
 * brand only, still at whichever store is cheapest; when no store has a price
 * for it yet, the cheapest of any brand stands in, and says so.
 */
export function pickCheapest(
  candidates: PriceCandidate[],
  preferredBrand: string | null
): (PriceCandidate & { brandMissing: boolean }) | null {
  const usable = candidates.filter((c) => Number.isFinite(c.perUnit) && c.perUnit > 0);
  const wanted = preferredBrand?.trim().toLowerCase();
  const ofBrand = wanted ? usable.filter((c) => (c.brand ?? "").trim().toLowerCase() === wanted) : usable;
  const pool = ofBrand.length > 0 ? ofBrand : usable;
  const best = pool.reduce<PriceCandidate | null>(
    (min, c) =>
      !min || c.perUnit < min.perUnit || (c.perUnit === min.perUnit && c.source === "paid" && min.source === "quoted")
        ? c
        : min,
    null
  );
  return best ? { ...best, brandMissing: !!wanted && ofBrand.length === 0 } : null;
}

export type ItemPrices = {
  /** The cheapest price available (#29), with where it is from. */
  cheapest?: (PriceCandidate & { brandMissing: boolean }) | null;
  /** Per base unit, from submitted receipts. */
  latestPaid?: number | null;
  cheapestRecent?: number | null;
  /** Per base unit, from a vendor offer on the Pricelist. */
  offer?: number | null;
};

/** "Costco, quoted 12/09" — where a price is from, beside it. */
export function priceFromLabel(c: PriceCandidate & { brandMissing?: boolean }): string {
  const when = c.date ? `${c.date.slice(8, 10)}/${c.date.slice(5, 7)}` : null;
  const what = [c.brand, c.vendorName].filter(Boolean).join(" at ");
  const label = [what || null, [c.source, when].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return c.brandMissing ? `${label} — the preferred brand has no price yet` : label;
}

export function priceFor(prices: ItemPrices | undefined): { perUnit: number | null; basis: PriceBasis; from?: string } {
  if (prices?.cheapest && prices.cheapest.perUnit > 0) {
    return {
      perUnit: prices.cheapest.perUnit,
      basis: prices.cheapest.source === "paid" ? "cheapest_paid" : "cheapest_quoted",
      from: priceFromLabel(prices.cheapest),
    };
  }
  if (prices?.latestPaid != null && prices.latestPaid > 0) {
    return { perUnit: prices.latestPaid, basis: "paid_latest" };
  }
  if (prices?.cheapestRecent != null && prices.cheapestRecent > 0) {
    return { perUnit: prices.cheapestRecent, basis: "paid_cheapest_recent" };
  }
  if (prices?.offer != null && prices.offer > 0) {
    return { perUnit: prices.offer, basis: "offer" };
  }
  return { perUnit: null, basis: "none" };
}

export type CostedLine = RequirementLine & {
  perUnit: number | null;
  basis: PriceBasis;
  /** Where the price is from, when known: "Taj at Coles, quoted 24/09". */
  from?: string;
  cost: number | null;
};

export type MenuDayCost = {
  lines: CostedLine[];
  /** What the priced lines come to. */
  total: number;
  /** Items with no price at all, which is why the total may be short. */
  unpriced: number;
  /** Total ÷ thaalis, or null when there are none to divide by. */
  perThaali: number | null;
};

export function costMenuDay(
  menu: MenuContents,
  thaalis: number,
  pricesByItem: Map<string, ItemPrices>
): MenuDayCost {
  const lines = requirementsFor(menu, thaalis).map((line) => {
    const { perUnit, basis, from } = priceFor(pricesByItem.get(line.itemId));
    return { ...line, perUnit, basis, from, cost: perUnit == null ? null : round2(line.quantity * perUnit) };
  });

  const total = round2(lines.reduce((sum, l) => sum + (l.cost ?? 0), 0));
  return {
    lines,
    total,
    unpriced: lines.filter((l) => l.cost == null).length,
    // Divided by what is being served, which is also what was cooked, since
    // a recipe scales to what is needed rather than to a whole pot.
    perThaali: thaalis > 0 ? round2(total / thaalis) : null,
  };
}

/** Three decimals: grams matter in a recipe, and kilos are the base unit. */
function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

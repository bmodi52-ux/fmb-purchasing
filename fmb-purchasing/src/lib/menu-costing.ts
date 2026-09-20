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

export type RecipeBasis = "batch" | "thaali";

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
  /** How many thaalis one batch feeds. Null on a per-thaali recipe. */
  batchThaalis: number | null;
  ingredients: RecipeLine[];
};

/**
 * How many times a recipe is made for a given number of thaalis.
 *
 * A batch recipe cannot be made in fractions — half a pot of bhuna gosht is
 * not a thing anyone cooks — so it rounds up, and what the rounding adds is
 * worth showing rather than hiding: 250 thaalis on a 200-thaali batch is two
 * batches, and the day feeds 400.
 */
export function batchesFor(dish: Pick<MenuDish, "basis" | "batchThaalis">, thaalis: number): number {
  if (thaalis <= 0) return 0;
  if (dish.basis === "thaali") return thaalis;
  const size = dish.batchThaalis ?? 0;
  if (size <= 0) return 0;
  return Math.ceil(thaalis / size);
}

/** Thaalis a batch recipe actually makes at that scale, which may exceed the count. */
export function thaalisMade(dish: Pick<MenuDish, "basis" | "batchThaalis">, thaalis: number): number {
  return dish.basis === "thaali" ? thaalis : batchesFor(dish, thaalis) * (dish.batchThaalis ?? 0);
}

export type RequirementLine = {
  itemId: string;
  itemName: string;
  /** In the item's base unit — kg, L, ea — which is what prices are per. */
  quantity: number;
  baseUnitCode: string;
  /** Which dishes asked for it, for a day that needs onions three times over. */
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
export function requirementsFor(dishes: MenuDish[], thaalis: number): RequirementLine[] {
  const byItem = new Map<string, RequirementLine>();

  for (const dish of dishes) {
    const scale = batchesFor(dish, thaalis);
    if (scale <= 0) continue;

    for (const line of dish.ingredients) {
      const quantity = line.quantity * scale * line.unitToBase;
      const existing = byItem.get(line.itemId);
      if (existing) {
        existing.quantity = round3(existing.quantity + quantity);
        if (!existing.fromDishes.includes(dish.dishName)) existing.fromDishes.push(dish.dishName);
      } else {
        byItem.set(line.itemId, {
          itemId: line.itemId,
          itemName: line.itemName,
          quantity: round3(quantity),
          baseUnitCode: line.baseUnitCode,
          fromDishes: [dish.dishName],
        });
      }
    }
  }

  return [...byItem.values()].sort((a, b) => a.itemName.localeCompare(b.itemName, "en", { sensitivity: "base" }));
}

/**
 * Where a price came from, in the order it is looked for.
 *
 * What was paid beats what was quoted, because a payment is a fact and a
 * quote is an intention — and the answer says which it used, so a figure
 * nobody can explain is impossible.
 */
export type PriceBasis = "paid_latest" | "paid_cheapest_recent" | "offer" | "none";

export const PRICE_BASIS_LABEL: Record<PriceBasis, string> = {
  paid_latest: "last paid",
  paid_cheapest_recent: "cheapest paid lately",
  offer: "vendor's quoted price",
  none: "no price yet",
};

export type ItemPrices = {
  /** Per base unit, from submitted receipts. */
  latestPaid?: number | null;
  cheapestRecent?: number | null;
  /** Per base unit, from a vendor offer on the Pricelist. */
  offer?: number | null;
};

export function priceFor(prices: ItemPrices | undefined): { perUnit: number | null; basis: PriceBasis } {
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
  dishes: MenuDish[],
  thaalis: number,
  pricesByItem: Map<string, ItemPrices>
): MenuDayCost {
  const lines = requirementsFor(dishes, thaalis).map((line) => {
    const { perUnit, basis } = priceFor(pricesByItem.get(line.itemId));
    return { ...line, perUnit, basis, cost: perUnit == null ? null : round2(line.quantity * perUnit) };
  });

  const total = round2(lines.reduce((sum, l) => sum + (l.cost ?? 0), 0));
  return {
    lines,
    total,
    unpriced: lines.filter((l) => l.cost == null).length,
    // Divided by what is being served, not by what the batches happen to
    // make: the question is what a thaali costs, and the extra from rounding
    // a batch up is part of that cost.
    perThaali: thaalis > 0 ? round2(total / thaalis) : null,
  };
}

/** Three decimals: grams matter in a recipe, and kilos are the base unit. */
function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

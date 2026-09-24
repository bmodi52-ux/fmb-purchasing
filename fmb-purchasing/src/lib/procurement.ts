import { round2 } from "@/lib/expense-money";

/**
 * Buying what a released menu needs, and matching what was bought back to it
 * (#70, pieces three and four).
 *
 * Three bits of arithmetic live here, away from the pages that show them:
 * rounding a requirement up to what a vendor actually sells, splitting a
 * receipt line across the days it was bought for, and saying how much of a
 * requirement is still outstanding.
 */

export type PackOption = {
  packSizeId: string;
  title: string;
  /** How much one pack holds, in the item's base unit. */
  totalQuantity: number;
};

export type PackSuggestion = {
  packSizeId: string;
  title: string;
  packs: number;
  /** What those packs come to, which is at least the requirement. */
  quantity: number;
  /** How much more than needed, rounded to the unit. */
  over: number;
};

/**
 * What to actually order for a requirement.
 *
 * 36 litres of tomato purée is nine 4 L boxes; nobody sells 36 litres. The
 * pack that wastes least wins, and ties go to the larger pack, since fewer
 * boxes is less to carry. What the rounding adds is returned rather than
 * hidden, because it is the difference between the plan and the bill.
 */
export function suggestPacks(required: number, packs: PackOption[]): PackSuggestion | null {
  const usable = packs.filter((p) => p.totalQuantity > 0);
  if (required <= 0 || usable.length === 0) return null;

  let best: PackSuggestion | null = null;
  for (const pack of usable) {
    const count = Math.ceil(round3(required / pack.totalQuantity));
    const quantity = round3(count * pack.totalQuantity);
    const over = round3(quantity - required);
    if (!best || over < best.over || (over === best.over && pack.totalQuantity > packQuantity(usable, best))) {
      best = { packSizeId: pack.packSizeId, title: pack.title, packs: count, quantity, over };
    }
  }
  return best;
}

function packQuantity(packs: PackOption[], suggestion: PackSuggestion): number {
  return packs.find((p) => p.packSizeId === suggestion.packSizeId)?.totalQuantity ?? 0;
}

/** One way to buy an item: a store's offer on one pack, at today's price (#29). */
export type BuyOption = {
  offerId: string;
  packSizeId: string;
  title: string;
  /** How much one pack holds, in the item's base unit. */
  totalQuantity: number;
  /** Priced by weight or each: `price` is then per base unit and nothing is rounded. */
  soldLoose: boolean;
  vendorId: string;
  vendorName: string;
  brand: string | null;
  /** Today's price — the special while it runs (see offer-pricing priceOn). */
  price: number;
  onSpecial: boolean;
  saleEndsOn: string | null;
};

export type CheapestBuy = BuyOption & {
  /** How many packs; null when bought loose. */
  packs: number | null;
  quantity: number;
  over: number;
  cost: number;
  /** The item has a preferred brand but no store prices it yet. */
  brandMissing: boolean;
};

/**
 * The cheapest way to buy what a line needs (#29): each store's offer on each
 * pack, bought in whole packs, costed at today's price — so a special counts
 * while it runs — and the lowest total wins. A dearer-per-kg small pack can
 * beat a big one that would mostly go to waste. An item with a preferred brand
 * is bought in that brand, still at the cheapest store. Ties go to less waste,
 * then the larger pack.
 */
export function cheapestBuy(required: number, options: BuyOption[], preferredBrand: string | null): CheapestBuy | null {
  const usable = options.filter((o) => o.price > 0 && (o.soldLoose || o.totalQuantity > 0));
  if (required <= 0 || usable.length === 0) return null;
  const wanted = preferredBrand?.trim().toLowerCase();
  const ofBrand = wanted ? usable.filter((o) => (o.brand ?? "").trim().toLowerCase() === wanted) : usable;
  const pool = ofBrand.length > 0 ? ofBrand : usable;

  let best: CheapestBuy | null = null;
  for (const o of pool) {
    const packs = o.soldLoose ? null : Math.ceil(round3(required / o.totalQuantity));
    const quantity = packs == null ? required : round3(packs * o.totalQuantity);
    const cost = round2(packs == null ? required * o.price : packs * o.price);
    const candidate: CheapestBuy = {
      ...o,
      packs,
      quantity,
      over: round3(quantity - required),
      cost,
      brandMissing: !!wanted && ofBrand.length === 0,
    };
    if (
      !best ||
      cost < best.cost ||
      (cost === best.cost && candidate.over < best.over) ||
      (cost === best.cost && candidate.over === best.over && o.totalQuantity > best.totalQuantity)
    ) {
      best = candidate;
    }
  }
  return best;
}

export type OpenRequirement = {
  requirementId: string;
  itemId: string;
  serviceDate: string;
  /** What the day needs, in the item's base unit. */
  quantity: number;
  /** What has already been allocated to it. */
  allocated: number;
};

export type AllocatableLine = {
  lineItemId: string;
  itemId: string;
  /** In the item's base unit, where the receipt said so. */
  quantity: number | null;
  lineTotal: number;
};

export type ProposedAllocation = {
  lineItemId: string;
  requirementId: string;
  quantity: number;
  amount: number;
};

/**
 * Which requirements a receipt's lines were probably bought for.
 *
 * A receipt belongs to no day — it is bought days early, days late, or for
 * several days at once — so its lines are matched against what is still
 * outstanding for that item, earliest day first. 200 kg of goat against days
 * needing 120 and 80 splits between them; 200 kg against a single day needing
 * 120 allocates 120 and leaves the rest over, which is a fact worth showing
 * rather than forcing onto a day that did not ask for it.
 *
 * The money follows the quantity, so a line split two ways is split in the
 * same proportion.
 */
export function proposeAllocations(lines: AllocatableLine[], open: OpenRequirement[]): ProposedAllocation[] {
  const outstanding = new Map<string, number>();
  for (const req of open) {
    outstanding.set(req.requirementId, round3(Math.max(0, req.quantity - req.allocated)));
  }

  const byItem = new Map<string, OpenRequirement[]>();
  for (const req of [...open].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate))) {
    byItem.set(req.itemId, [...(byItem.get(req.itemId) ?? []), req]);
  }

  const proposals: ProposedAllocation[] = [];
  for (const line of lines) {
    // No quantity on the line means nothing can be split fairly; a whole
    // line against one requirement is still better than nothing.
    const available = line.quantity && line.quantity > 0 ? line.quantity : null;
    let left = available;

    for (const req of byItem.get(line.itemId) ?? []) {
      const want = outstanding.get(req.requirementId) ?? 0;
      if (want <= 0) continue;

      if (left === null) {
        proposals.push({
          lineItemId: line.lineItemId,
          requirementId: req.requirementId,
          quantity: want,
          amount: round2(line.lineTotal),
        });
        outstanding.set(req.requirementId, 0);
        break;
      }

      const take = round3(Math.min(left, want));
      if (take <= 0) continue;
      proposals.push({
        lineItemId: line.lineItemId,
        requirementId: req.requirementId,
        quantity: take,
        amount: round2((take / available!) * line.lineTotal),
      });
      outstanding.set(req.requirementId, round3(want - take));
      left = round3(left - take);
      if (left <= 0) break;
    }
  }

  return proposals;
}

/** What a day's requirement still needs, and what has been spent against it. */
export function progressOf(requirement: { quantity: number }, allocations: { quantity: number; amount: number }[]) {
  const bought = round3(allocations.reduce((sum, a) => sum + a.quantity, 0));
  const spent = round2(allocations.reduce((sum, a) => sum + a.amount, 0));
  return {
    bought,
    spent,
    outstanding: round3(Math.max(0, requirement.quantity - bought)),
    complete: bought + 0.001 >= requirement.quantity,
  };
}

function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}

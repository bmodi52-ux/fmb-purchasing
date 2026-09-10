import { canonicalUnitCode } from "@/lib/units";
import { packagingFromText } from "@/lib/pack-description";
import { packShapeFromDescription } from "@/lib/pack-shape";

/**
 * Which Pricelist item, and which of its packs, a receipt line is.
 *
 * Receipts and the Pricelist describe the same product differently. An item
 * is set up as "Tomato"; the invoice says "Box Tomato", "Tomatoes", "16 Box
 * Tomato". Matching used to compare the whole wording exactly, and only at
 * submission, so none of those found the item somebody had already set up —
 * each quietly became a new item named after the receipt, and nobody saw it
 * happen until the Pricelist had two tomatoes.
 *
 * So this reads a line the way a person does. The quantity, the packaging and
 * the plural are how the thing was bought, not what it is, and are set aside
 * before comparing ("20kg Onions" is onions); a misspelt word still counts
 * ("Corriander"); and a wording this vendor has used before is remembered
 * outright. What it cannot be sure of it says so, and the submit form puts
 * that in front of the person holding the invoice rather than guessing.
 *
 * Pure, so every rule here is tested without a database.
 */

export type CatalogueUnit = { code: string; baseUnitCode: string; toBaseFactor: number };

export type CataloguePack = {
  id: string;
  label: string | null;
  innerQuantity: number;
  /** The code of the unit the pack is measured in — "kg", "ea". */
  unitCode: string | null;
  packCount: number;
  soldLoose: boolean;
  packaging: string | null;
};

export type CatalogueItem = {
  id: string;
  name: string;
  itemNumber: string | null;
  categoryName: string | null;
  packs: CataloguePack[];
};

/** A wording a receipt has used for an item before — see vendor_item_descriptions. */
export type KnownWording = { itemId: string; vendorId: string | null; description: string };

/**
 * sure    — the item's own name, or a wording this app has been told means it
 * likely  — the right item on the evidence, but worth a glance: an extra word
 *           on the line, a misspelling, or a tie broken by category
 * none    — nothing, or several equally good items to choose between
 */
export type MatchConfidence = "sure" | "likely" | "none";

export type ItemPick = {
  confidence: MatchConfidence;
  itemId: string | null;
  /** Other items worth offering, best first. */
  alternatives: string[];
};

/** Lowercased and whitespace-collapsed, as vendor_item_descriptions stores it. */
export function normalizeWording(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Words that say nothing about which product it is. */
const FILLER_WORDS = new Set(["x", "of", "and", "the", "a", "an", "per", "for", "with", "loose", "approx", "each"]);

/**
 * A word reduced to a form both spellings share: "tomatoes" and "tomato",
 * "chillies" and "chilli", "berries" and "berry" all compare equal.
 */
function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}i`;
  if (w.length > 4 && /(o|x|ch|sh|ss)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("y")) return `${w.slice(0, -1)}i`;
  return w;
}

/**
 * The words in a description that name the product: "15kg Wash Potatoes" is
 * wash and potato. Numbers, units and packaging are how it was bought.
 */
export function coreWords(text: string): string[] {
  const tokens = text.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) ?? [];
  const words: string[] = [];
  for (const token of tokens) {
    if (/^\d/.test(token)) continue;
    if (FILLER_WORDS.has(token)) continue;
    if (canonicalUnitCode(token)) continue;
    if (packagingFromText(token)) continue;
    const word = stem(token);
    if (word.length < 2 || words.includes(word)) continue;
    words.push(word);
  }
  return words;
}

function bigrams(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length - 1; i++) out.push(word.slice(i, i + 2));
  return out;
}

/** How alike two words are, 0 to 1, by the letter pairs they share. */
function dice(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  if (left.length + right.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const pair of right) counts.set(pair, (counts.get(pair) ?? 0) + 1);
  let shared = 0;
  for (const pair of left) {
    const n = counts.get(pair) ?? 0;
    if (n > 0) {
      shared++;
      counts.set(pair, n - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}

/**
 * Whether two words are the same word, allowing a handwriting-sized slip in a
 * longer one — "corriander", "tomatoe". Short words must match exactly:
 * "beef" and "beet" are one letter apart and nothing alike.
 */
function sameWord(a: string, b: string): "exact" | "close" | null {
  if (a === b) return "exact";
  if (Math.min(a.length, b.length) < 5) return null;
  return dice(a, b) >= 0.8 ? "close" : null;
}

type Comparison = {
  /**
   * 3 — the same words
   * 2 — every word of the item is on the line, plus more ("Jumbo Ginger")
   * 1 — every word of the line is in the item, which has more ("Chilli" for Green Chilli)
   * 0 — some words in common
   */
  tier: number;
  itemCovered: number;
  fuzzy: boolean;
};

function compare(itemWords: string[], lineWords: string[]): Comparison | null {
  if (itemWords.length === 0 || lineWords.length === 0) return null;

  let itemCovered = 0;
  let fuzzy = false;
  for (const w of itemWords) {
    let best: "exact" | "close" | null = null;
    for (const l of lineWords) {
      const same = sameWord(w, l);
      if (same === "exact") {
        best = "exact";
        break;
      }
      if (same === "close") best = "close";
    }
    if (best) {
      itemCovered++;
      if (best === "close") fuzzy = true;
    }
  }
  if (itemCovered === 0) return null;

  const lineCovered = lineWords.filter((l) => itemWords.some((w) => sameWord(w, l))).length;
  const allItem = itemCovered === itemWords.length;
  const allLine = lineCovered === lineWords.length;
  const tier = allItem && allLine ? 3 : allItem ? 2 : allLine ? 1 : 0;
  return { tier, itemCovered, fuzzy };
}

function better(a: Comparison, b: Comparison): boolean {
  if (a.tier !== b.tier) return a.tier > b.tier;
  if (a.itemCovered !== b.itemCovered) return a.itemCovered > b.itemCovered;
  return !a.fuzzy && b.fuzzy;
}

const NO_MATCH: ItemPick = { confidence: "none", itemId: null, alternatives: [] };

/** Which item a line is, and how sure that is. */
export function matchLine(
  line: { description: string; categoryName?: string | null },
  catalogue: CatalogueItem[],
  wordings: KnownWording[],
  vendorId: string | null
): ItemPick {
  const known = new Set(catalogue.map((i) => i.id));
  const wording = normalizeWording(line.description);
  if (!wording) return NO_MATCH;

  // A wording already tied to exactly one item is the strongest evidence
  // there is — this vendor's own first, then anyone's.
  const rememberedBy = (ownVendorOnly: boolean) =>
    new Set(
      wordings
        .filter((w) => known.has(w.itemId) && normalizeWording(w.description) === wording)
        .filter((w) => !ownVendorOnly || (vendorId !== null && w.vendorId === vendorId))
        .map((w) => w.itemId)
    );
  for (const ids of [rememberedBy(true), rememberedBy(false)]) {
    if (ids.size === 1) return { confidence: "sure", itemId: [...ids][0]!, alternatives: [] };
  }

  const lineWords = coreWords(line.description);
  if (lineWords.length === 0) return NO_MATCH;

  const aliases = new Map<string, string[]>();
  for (const w of wordings) aliases.set(w.itemId, [...(aliases.get(w.itemId) ?? []), w.description]);

  const candidates: (Comparison & { item: CatalogueItem })[] = [];
  for (const item of catalogue) {
    let best: Comparison | null = null;
    for (const text of [item.name, ...(aliases.get(item.id) ?? [])]) {
      const result = compare(coreWords(text), lineWords);
      if (result && (!best || better(result, best))) best = result;
    }
    if (best) candidates.push({ ...best, item });
  }
  if (candidates.length === 0) return NO_MATCH;

  candidates.sort(
    (a, b) =>
      b.tier - a.tier ||
      b.itemCovered - a.itemCovered ||
      Number(a.fuzzy) - Number(b.fuzzy) ||
      a.item.name.localeCompare(b.item.name)
  );
  const top = candidates[0]!;

  // A word or two in common is a hint, not an answer.
  if (top.tier === 0) {
    return { confidence: "none", itemId: null, alternatives: candidates.slice(0, 3).map((c) => c.item.id) };
  }

  let chosen = top;
  let tieBroken = false;
  const peers = candidates.filter(
    (c) => c.tier === top.tier && c.itemCovered === top.itemCovered && c.fuzzy === top.fuzzy
  );
  if (peers.length > 1) {
    // "Mince" under Beef and under Lamb: the category extraction read is the
    // only thing left to go on, and only if it picks out exactly one.
    const wanted = line.categoryName?.toLowerCase();
    const inCategory = wanted ? peers.filter((c) => c.item.categoryName?.toLowerCase() === wanted) : [];
    if (inCategory.length !== 1) {
      return { confidence: "none", itemId: null, alternatives: peers.slice(0, 4).map((c) => c.item.id) };
    }
    chosen = inCategory[0]!;
    tieBroken = true;
  }

  return {
    confidence: chosen.tier === 3 && !chosen.fuzzy && !tieBroken ? "sure" : "likely",
    itemId: chosen.item.id,
    alternatives: candidates
      .filter((c) => c !== chosen && c.tier >= 1)
      .slice(0, 3)
      .map((c) => c.item.id),
  };
}

function inBaseUnits(quantity: number, unitCode: string | null, units: CatalogueUnit[]) {
  const unit = units.find((u) => u.code.toLowerCase() === (unitCode ?? "").toLowerCase());
  return unit ? { amount: quantity * unit.toBaseFactor, base: unit.baseUnitCode } : null;
}

const LOOSE_WORDING = /\bloose\b|\bper\s*(kg|kilo|kilogram|g|gram|l|litre|liter|ml)\b/i;

/**
 * Which of an item's packs a line is, or null when the line doesn't say.
 *
 * Read from what the line states — "Box Tomato" is the box, "20kg Onions" the
 * 20 kg bag, "loose" the loose pack, "Jumbo Tomato" the pack named Jumbo Box —
 * and then from which pack this vendor already sells. Null rather than a guess
 * when two packs are equally likely: the pack decides what a quantity of 16
 * means, sixteen boxes or sixteen kilos. Two 10 kg boxes that differ only by
 * grade are exactly that case unless the line names the grade.
 */
export function choosePack(
  packs: CataloguePack[],
  description: string,
  units: CatalogueUnit[],
  vendorPackIds: ReadonlySet<string>,
  /** The item's name, whose words say nothing about which pack it is. */
  itemName = ""
): string | null {
  if (packs.length === 0) return null;
  if (packs.length === 1) return packs[0]!.id;

  const packaging = packagingFromText(description);
  const loose = LOOSE_WORDING.test(description);
  const stated = packShapeFromDescription(description);
  const statedAmount = stated
    ? inBaseUnits(stated.innerQuantity * stated.packCount, stated.unitCode, units)
    : null;
  const nameWords = coreWords(itemName);
  const lineWords = coreWords(description).filter((w) => !nameWords.some((n) => sameWord(n, w)));

  const scored = packs
    .map((pack) => {
      let score = 0;
      if (packaging && pack.packaging === packaging) score += 2;
      if (loose && pack.soldLoose) score += 2;
      // A word the pack's own name adds — "Jumbo" in Jumbo Box — said on the line.
      const labelWords = coreWords(pack.label ?? "").filter((w) => !nameWords.some((n) => sameWord(n, w)));
      if (labelWords.some((w) => lineWords.some((l) => sameWord(w, l)))) score += 2;
      if (statedAmount) {
        const packAmount = inBaseUnits(pack.innerQuantity * pack.packCount, pack.unitCode, units);
        if (
          packAmount &&
          packAmount.base === statedAmount.base &&
          Math.abs(packAmount.amount - statedAmount.amount) < 1e-6
        ) {
          score += 3;
        }
      }
      if (vendorPackIds.has(pack.id)) score += 1;
      return { pack, score };
    })
    .sort((a, b) => b.score - a.score);

  const [first, second] = scored;
  return first!.score > 0 && first!.score > (second?.score ?? -1) ? first!.pack.id : null;
}

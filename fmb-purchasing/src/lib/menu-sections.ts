/**
 * The lists a thaali day is bought in (#70): Meat, Fresh produce and Dry
 * goods — Meat, Veggies and Rashan as the sheet has them — and Roti (#76).
 *
 * Meat and Fresh produce are fixed, because they are bought from different
 * people on different days and nobody would want them merged. Dry goods is
 * everything else, which is why it is the one that will want editing later:
 * disposables and cleaning are not groceries, and somebody will eventually
 * want them apart.
 *
 * A section is worked out from the item's own category rather than stored on
 * the item, so a new item lands in the right list the moment it is
 * categorised, and nothing has to be kept in step by hand.
 */

/**
 * Roti is its own list rather than part of Dry goods: on the days it is on at
 * all, it is ordered from a baker by whoever arranges it. Bread would
 * otherwise fall in with the rice and the oil, where nobody would look for it.
 */
export const SECTIONS = ["meat", "produce", "dry", "roti"] as const;
export type SectionKey = (typeof SECTIONS)[number];

export const SECTION_LABEL: Record<SectionKey, string> = {
  meat: "Meat",
  produce: "Fresh produce",
  dry: "Dry goods",
  roti: "Roti",
};

/** Matched against the top of the category tree, lowercased. */
const MEAT = /\b(meat|poultry|chicken|lamb|mutton|beef|goat|fish|seafood)\b/;
const PRODUCE = /\b(produce|fruit|vegetable|vegetables|veg|herbs?)\b/;
const ROTI = /\b(roti|rotli|bread|chapat(i|ti)|naan)\b/;

/**
 * Which list an item belongs on, from its category and that category's
 * parent — "Meat & Poultry › Lamb" is meat whichever of the two is read.
 */
export function isSection(value: unknown): value is SectionKey {
  return typeof value === "string" && (SECTIONS as readonly string[]).includes(value);
}

/**
 * The section for one item: what the item says, else what its category says,
 * else what the names suggest.
 *
 * Stated beats guessed — an item moved to another list stays there — and the
 * guess is the default so that nothing has to be set up before this works.
 */
export function resolveSection(input: {
  itemSection?: string | null;
  categorySection?: string | null;
  parentSection?: string | null;
  categoryName?: string | null;
  parentName?: string | null;
}): SectionKey {
  if (isSection(input.itemSection)) return input.itemSection;
  if (isSection(input.categorySection)) return input.categorySection;
  if (isSection(input.parentSection)) return input.parentSection;
  return sectionFor([input.parentName, input.categoryName]);
}

export function sectionFor(categoryNames: (string | null | undefined)[]): SectionKey {
  const text = categoryNames.filter(Boolean).join(" ").toLowerCase();
  if (ROTI.test(text)) return "roti";
  if (MEAT.test(text)) return "meat";
  if (PRODUCE.test(text)) return "produce";
  return "dry";
}

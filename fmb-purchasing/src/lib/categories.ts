export type CategoryRow = { id: string; name: string; parent_category_id: string | null };

/**
 * A category becomes a display-only grouping node once something else names it
 * as a parent.
 *
 * Generic so a caller that selected more columns — applies_to, code — gets
 * them back rather than having the row narrowed to the three this needs.
 */
export function leafCategories<T extends CategoryRow>(categories: T[]): T[] {
  const parentIds = new Set(categories.map((c) => c.parent_category_id).filter((id): id is string => id !== null));
  return categories.filter((c) => !parentIds.has(c.id));
}

/** Full "Parent › Child" display name for every category, keyed by id. */
export function categoryLabelsById(categories: CategoryRow[]): Map<string, string> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return new Map(
    categories.map((c) => {
      const parent = c.parent_category_id ? byId.get(c.parent_category_id) : undefined;
      return [c.id, parent ? `${parent.name} › ${c.name}` : c.name];
    })
  );
}

/**
 * Categories in the order people expect to read them.
 *
 * The list has always come back in sort_order, which nothing in the app can
 * set: the seeded categories carry the numbers migration 0024 gave them and
 * every category added since defaults to the same 500, so the order on screen
 * was really the order things happened to be created in. Lamb after Chicken,
 * Nuts & Dryfoods below Professional & Contractor Services.
 *
 * Sorted by full label rather than by name, which keeps a subcategory directly
 * under its parent instead of wherever its own initial falls — "Meat & Poultry"
 * sorts before "Meat & Poultry › Beef", and its siblings follow in turn.
 */
export function sortCategories<T extends CategoryRow>(categories: T[]): T[] {
  const labels = categoryLabelsById(categories);
  const key = (c: T) => labels.get(c.id) ?? c.name;
  return [...categories].sort((a, b) =>
    key(a).localeCompare(key(b), "en", { sensitivity: "base" })
  );
}

/**
 * The line kinds a category can be tagged for, mirroring the
 * categories_applies_to_known constraint in migration 0038.
 *
 * Three groups rather than one per line kind: every charge kind — surcharge,
 * delivery, discount, rounding — wants the same short list, and splitting them
 * would be four columns of the same answer.
 */
export const CATEGORY_LINE_GROUPS = ["goods", "service", "charge"] as const;

export type CategoryLineGroup = (typeof CATEGORY_LINE_GROUPS)[number];

/** Which group a line's own kind falls in. */
export function lineGroupFor(kind: string): CategoryLineGroup {
  return kind === "goods" ? "goods" : kind === "service" ? "service" : "charge";
}

/**
 * Split a category list into the ones this kind of line is usually filed
 * under, and everything else.
 *
 * "Everything else" is kept rather than dropped on purpose: a category tagged
 * wrongly would otherwise make a legitimate expense impossible to file, and
 * being unable to categorise a receipt is a worse failure than scrolling past
 * a few headings. An untagged category counts as relevant to everything, so
 * one added tomorrow is never hidden.
 */
export function categoriesForLineGroup<T extends { appliesTo?: string[] | null }>(
  categories: T[],
  group: CategoryLineGroup
): { relevant: T[]; others: T[] } {
  const relevant: T[] = [];
  const others: T[] = [];
  for (const category of categories) {
    const tags = category.appliesTo ?? [];
    if (tags.length === 0 || tags.includes(group)) relevant.push(category);
    else others.push(category);
  }
  return { relevant, others };
}

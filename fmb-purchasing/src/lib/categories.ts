export type CategoryRow = { id: string; name: string; parent_category_id: string | null };

/** A category becomes a display-only grouping node once something else names it as a parent. */
export function leafCategories(categories: CategoryRow[]): CategoryRow[] {
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

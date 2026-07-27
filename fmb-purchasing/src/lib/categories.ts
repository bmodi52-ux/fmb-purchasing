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

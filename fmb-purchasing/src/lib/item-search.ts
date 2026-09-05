import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Item numbers stopped being permanent in 0024: reclassifying an item changes
 * its category prefix, so CHK-0042 becomes BEF-0042. Every number that goes
 * out of use is kept in item_number_aliases, and a typeahead that only
 * searched items.item_number would silently fail to find an item by the
 * number printed on last month's sheet.
 *
 * A separate query rather than a join because PostgREST's `.or()` cannot
 * reach across tables.
 */
export async function itemIdsByRetiredNumber(
  admin: SupabaseClient,
  query: string
): Promise<string[]> {
  const { data } = await admin
    .from("item_number_aliases")
    .select("item_id")
    .ilike("item_number", `%${query}%`)
    .limit(20);

  return [...new Set((data ?? []).map((row) => row.item_id as string))];
}

/**
 * PostgREST `.or()` filter matching an item by current number, name, or any
 * number it used to have.
 */
export function itemMatchFilter(query: string, retiredMatchIds: string[]): string {
  const clauses = [`item_number.ilike.%${query}%`, `name.ilike.%${query}%`];
  if (retiredMatchIds.length > 0) clauses.push(`id.in.(${retiredMatchIds.join(",")})`);
  return clauses.join(",");
}

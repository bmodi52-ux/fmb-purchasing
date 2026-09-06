import type { SupabaseClient } from "@supabase/supabase-js";
import { ilikeContains, inList, orFilter } from "@/lib/pgrst-filter";

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
    // `.ilike()` takes the pattern as a value rather than as part of a filter
    // string, so the client escapes it — nothing to quote here.
    .ilike("item_number", `%${query}%`)
    .limit(20);

  return [...new Set((data ?? []).map((row) => row.item_id as string))];
}

/**
 * PostgREST `.or()` filter matching an item by current number, name, or any
 * number it used to have.
 *
 * Values go through pgrst-filter rather than being interpolated: this string
 * is parsed by PostgREST, and an unquoted bracket or comma in the search term
 * used to break the whole query — so searching for "Coca-Cola (2L)" returned
 * nothing at all, with no error shown.
 */
export function itemMatchFilter(query: string, retiredMatchIds: string[]): string {
  const clauses = [ilikeContains("item_number", query), ilikeContains("name", query)];
  if (retiredMatchIds.length > 0) clauses.push(inList("id", retiredMatchIds));
  return orFilter(...clauses);
}

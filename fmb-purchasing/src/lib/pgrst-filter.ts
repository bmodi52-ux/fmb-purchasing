/**
 * Building PostgREST filter strings out of things people type.
 *
 * `.or()` takes one string in which commas separate terms, parentheses group
 * them, and dots separate column from operator from value:
 *
 *     name.ilike.%chicken%,vendor_number.ilike.%chicken%
 *
 * Every search box in this app interpolated the raw search term straight into
 * that string. No data could leak — the queries that matter also carry an
 * ANDed `status = 'approved'` that no injected OR term can escape — but the
 * grammar breaks the moment somebody types a character it reserves:
 *
 *     "Coca-Cola (2L)"   unbalanced parenthesis    -> 400, no results
 *     "Smith, John"      an extra term             -> 400 or a wrong match
 *
 * The typeahead then shows nothing, with no error and no explanation, for a
 * search that looks perfectly ordinary to the person typing it. That matters
 * more than it used to: with receipts submitted through the site, nearly a
 * fifth of them have no receipt file at all and are typed in by hand against
 * exactly these lookups.
 *
 * PostgREST accepts a double-quoted value, within which `"` and `\` are
 * backslash-escaped and everything else — commas, parentheses, dots — is
 * literal. Quoting is therefore the whole fix.
 */

/**
 * A value, quoted so PostgREST reads it as one opaque literal.
 *
 * Note on `%` and `_`: both stay live as LIKE wildcards inside the pattern.
 * That is deliberate. Escaping them would need a backslash that must itself
 * survive the quoting, and the only effect of leaving them is that a search
 * for "50%" also matches "50c" — a broader result set, never a wrong or
 * failed one, in a box whose whole job is finding things by fragment.
 */
export function pgrstValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `column.ilike."%term%"` — a contains-match, safe for any term. */
export function ilikeContains(column: string, term: string): string {
  return `${column}.ilike.${pgrstValue(`%${term}%`)}`;
}

/** Joins filter terms into the single string `.or()` expects. */
export function orFilter(...terms: string[]): string {
  return terms.join(",");
}

/**
 * `column.in.("a","b")` for a list of ids.
 *
 * Ids reaching this are UUIDs read back from our own tables rather than user
 * input, but they are quoted on the same principle: a filter builder that
 * quotes some of its values and trusts others is one refactor away from
 * trusting the wrong one.
 */
export function inList(column: string, values: string[]): string {
  return `${column}.in.(${values.map(pgrstValue).join(",")})`;
}

/**
 * Telling whether two vendor records are the same business (#45).
 *
 * Pure functions, so the client form, the read-only resolver and the write
 * path all agree, and so they can be tested without a database.
 */

const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/**
 * The ABR's own check on an ABN: take 1 from the first digit, weight the
 * eleven digits, and the sum must divide by 89. A misread digit almost always
 * fails it: 37 003 900 427 (Nimco Foods) passes, the 03 003 900 427 a receipt
 * was read as does not.
 */
export function isValidAbn(abn: string): boolean {
  const digits = abn.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  const values = [...digits].map(Number);
  values[0]! -= 1;
  const sum = values.reduce((total, d, i) => total + d * ABN_WEIGHTS[i]!, 0);
  return sum % 89 === 0;
}

/** Words that say what kind of entity a business is, not which business. */
const ENTITY_WORDS = new Set([
  "pty",
  "ltd",
  "limited",
  "proprietary",
  "p/l",
  "pl",
  "inc",
  "incorporated",
  "co",
  "company",
  "corp",
  "corporation",
  "the",
  "a",
  "partnership",
  "trust",
  "trustee",
  "for",
  "as",
]);

function core(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    // Brackets usually hold entity detail: "(A LIMITED PARTNERSHIP)".
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9/ ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !ENTITY_WORDS.has(w))
    .join(" ");
}

/**
 * The names a vendor could be known by, reduced for comparison: case,
 * punctuation and "Pty Ltd" and the like ignored, and both sides of a
 * trading name — "FULBECK PTY. LIMITED T/A Nimco Foods" is known as
 * "fulbeck" and as "nimco foods".
 */
export function vendorNameKeys(name: string): string[] {
  const sides = name.split(/\s+(?:t\/a|t\/as|trading as|atf)\s+/i);
  const keys = new Set<string>();
  for (const side of [name, ...sides]) {
    const key = core(side);
    if (key) keys.add(key);
  }
  return [...keys];
}

/** Whether two vendor names plausibly name the same business. */
export function vendorNamesMatch(a: string, b: string): boolean {
  const keysA = vendorNameKeys(a);
  const keysB = new Set(vendorNameKeys(b));
  return keysA.some((k) => keysB.has(k));
}

/**
 * Whether a vendor found by name may stand for a receipt. Two different ABNs
 * are two different businesses, whatever they are called; either side
 * without an ABN leaves the name to decide.
 */
export function abnsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = a?.replace(/\D/g, "") || null;
  const y = b?.replace(/\D/g, "") || null;
  return !x || !y || x === y;
}

/**
 * How an expense's vendor is named wherever it is shown or exported: the
 * vendor's record first, then what the receipt said. Reports and Accounting
 * named it one way and All expenses and Payments the other, so the same
 * vendor could be spelled two ways in two files about the same money.
 */
export function vendorLabel(recordName: string | null | undefined, raw: string | null | undefined): string {
  return recordName?.trim() || raw?.trim() || "Unrecorded vendor";
}

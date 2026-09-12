/**
 * Replacing the real details in a copy of the database (scratchpad #1).
 *
 * The sandbox holds a copy of real data so training looks like the job, but
 * nobody being trained should see a supplier's bank account or a member's
 * address. Vendors, people and bank details are replaced with invented ones
 * that are stable: the same vendor is the same fake vendor at every reset, so
 * a trainee's screenshots and a trainer's notes still agree.
 *
 * Free text is handled separately and matters as much: a submitter's comment
 * saying "pay Miqdad Bhai" names a person the rest of the scrub has already
 * renamed. Every real name that was replaced is rewritten wherever it appears.
 */

/** FNV-1a: a small, stable hash, so the same id always yields the same pseudonym. */
export function seedOf(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const pick = <T>(list: readonly T[], seed: number, salt = 0): T => list[(seed + salt * 7919) % list.length];

const PLACES = [
  "Harbour", "Parramatta", "Auburn", "Lidcombe", "Granville", "Rosehill", "Bankstown",
  "Homebush", "Merrylands", "Silverwater", "Wentworth", "Carlingford",
] as const;

const TRADES = [
  "Provisions", "Poultry", "Produce", "Trading", "Wholesale", "Foods", "Supplies",
  "Meats", "Grocers", "Dairy", "Packaging", "Services",
] as const;

const FIRST_NAMES = [
  "Adam", "Bilal", "Carim", "Danish", "Ebrahim", "Faiz", "Ghulam", "Hatim",
  "Idris", "Jafar", "Kamal", "Latif", "Munir", "Nadir", "Qasim", "Rashid",
] as const;

const LAST_NAMES = [
  "Ansari", "Batliwala", "Contractor", "Dhukka", "Engineer", "Fakhri", "Ghadiali",
  "Hakimi", "Jamali", "Kagalwala", "Lokhandwala", "Mithaiwala", "Nomani", "Poonawala",
] as const;

/** "Auburn Provisions" — recognisably a business, recognisably not a real one. */
export function scrubbedVendorName(id: string): string {
  const seed = seedOf(id);
  return `${pick(PLACES, seed)} ${pick(TRADES, seed, 1)}`;
}

export function scrubbedPersonName(id: string): string {
  const seed = seedOf(id);
  return `${pick(FIRST_NAMES, seed)} ${pick(LAST_NAMES, seed, 1)}`;
}

/** Invalid on purpose: nothing sent here can reach anybody. */
export function scrubbedEmail(id: string, name?: string): string {
  const slug = (name ?? scrubbedPersonName(id)).toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
  return `${slug}@sandbox.invalid`;
}

/** Eleven digits that look like an ABN and are not one: the check digits won't hold. */
export function scrubbedAbn(id: string): string {
  const seed = seedOf(id);
  return String(10_000_000_000 + (seed % 89_999_999_999));
}

export function scrubbedBsb(id: string): string {
  // 999 is unallocated, so no real bank is named.
  return `999${String(seedOf(id) % 1000).padStart(3, "0")}`;
}

export function scrubbedAccountNumber(id: string): string {
  return String(seedOf(id) % 100_000_000).padStart(8, "0");
}

export function scrubbedPhone(id: string): string {
  return `04${String(seedOf(id) % 100_000_000).padStart(8, "0")}`;
}

export function scrubbedAddress(id: string): { line1: string; line2: null; suburb: string; state: string; postcode: string; country: string } {
  const seed = seedOf(id);
  return {
    line1: `${(seed % 200) + 1} ${pick(PLACES, seed, 2)} Road`,
    line2: null,
    suburb: pick(PLACES, seed, 3),
    state: "NSW",
    postcode: String(2000 + (seed % 200)),
    country: "Australia",
  };
}

export type Replacement = { from: string; to: string };

/**
 * Rewrites every real name in free text, longest first so "Fresh Poultry Pty
 * Ltd" is replaced before "Fresh Poultry" can half-match inside it. Matching
 * ignores case; anything shorter than three characters is skipped, since a
 * two-letter name would rewrite parts of ordinary words.
 */
export function buildTextScrubber(replacements: Replacement[]): (value: string) => string {
  const usable = replacements
    .filter((r) => r.from && r.from.trim().length >= 3)
    .sort((a, b) => b.from.length - a.from.length);
  if (usable.length === 0) return (value) => value;

  const escaped = usable.map((r) => r.from.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(escaped.join("|"), "gi");
  const byLower = new Map(usable.map((r) => [r.from.trim().toLowerCase(), r.to]));
  return (value: string) => value.replace(pattern, (match) => byLower.get(match.toLowerCase()) ?? match);
}

/** Applies a text scrubber through anything a row can hold, including nested JSON. */
export function scrubDeep(value: unknown, scrub: (text: string) => string): unknown {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, scrub));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubDeep(v, scrub)]));
  }
  return value;
}

/**
 * Columns the database insists on generating itself.
 *
 * items.item_seq, expenses.expense_seq and vendors.vendor_seq are GENERATED
 * ALWAYS AS IDENTITY, so a copied row carrying one is refused outright. They
 * are dropped on the way in and the sandbox assigns its own, which the
 * numbering triggers then turn into item, expense and vendor numbers of its
 * own. Those numbers therefore differ from live — the sandbox is internally
 * consistent rather than number-for-number identical.
 */
export const GENERATED_COLUMNS: Record<string, string[]> = {
  items: ["item_seq", "item_number"],
  expenses: ["expense_seq", "expense_number"],
  vendors: ["vendor_seq", "vendor_number"],
};

export function withoutGeneratedColumns(table: string, row: Record<string, unknown>): Record<string, unknown> {
  const drop = GENERATED_COLUMNS[table];
  if (!drop) return row;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) if (!drop.includes(key)) out[key] = value;
  return out;
}

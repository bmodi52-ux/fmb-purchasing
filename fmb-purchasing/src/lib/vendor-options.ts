/** An approved vendor, as the Vendor and Vendor # pickers on Submit offer it (#59). */
export type VendorOption = {
  id: string;
  name: string;
  vendorNumber: string | null;
  /** Among the vendors this person has submitted for most recently. */
  recent: boolean;
};

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** "V-0008" and "8" are the same number to someone typing it. */
function sameNumber(vendorNumber: string | null, query: string): boolean {
  const q = digitsOf(query);
  const n = digitsOf(vendorNumber ?? "");
  return q !== "" && n !== "" && Number(q) === Number(n);
}

/**
 * The vendors to list for what has been typed, in the order to list them.
 *
 * Nothing typed lists everyone, recent ones first. Otherwise a vendor matches
 * on its name or its number: a number typed in full comes first, then names
 * beginning with what was typed, then names merely containing it.
 */
export function filterVendorOptions(
  vendors: VendorOption[],
  query: string,
  sortBy: "name" | "number"
): VendorOption[] {
  const byField =
    sortBy === "name"
      ? (a: VendorOption, b: VendorOption) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })
      : (a: VendorOption, b: VendorOption) =>
          (a.vendorNumber ?? "~").localeCompare(b.vendorNumber ?? "~", "en", { numeric: true });

  const q = query.trim().toLowerCase();
  if (!q) {
    return [...vendors].sort((a, b) => Number(b.recent) - Number(a.recent) || byField(a, b));
  }

  const rank = (v: VendorOption): number => {
    if (sameNumber(v.vendorNumber, q)) return 0;
    const name = v.name.toLowerCase();
    if (name.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    if ((v.vendorNumber ?? "").toLowerCase().includes(q)) return 3;
    return -1;
  };

  return vendors
    .map((v) => ({ v, r: rank(v) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => a.r - b.r || Number(b.v.recent) - Number(a.v.recent) || byField(a.v, b.v))
    .map(({ v }) => v);
}

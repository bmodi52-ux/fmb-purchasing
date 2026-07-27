/**
 * Receipt extraction returns whatever the invoice happened to say — "kgs",
 * "Litres", "pcs". Previously each new spelling was inserted as a brand new
 * unit, which quietly produced units that couldn't be compared with each
 * other. These map the common spellings onto the canonical codes seeded in
 * 0006; anything unrecognised falls back to the item's canonical unit rather
 * than inventing a row (new units are an admin action on the Pricelist page).
 */
const UNIT_ALIASES: Record<string, string> = {
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",

  g: "g",
  gm: "g",
  gms: "g",
  gram: "g",
  grams: "g",

  l: "L",
  lt: "L",
  ltr: "L",
  ltrs: "L",
  litre: "L",
  litres: "L",
  liter: "L",
  liters: "L",

  ml: "mL",
  mls: "mL",
  millilitre: "mL",
  millilitres: "mL",
  milliliter: "mL",
  milliliters: "mL",

  ea: "ea",
  each: "ea",
  pc: "ea",
  pcs: "ea",
  piece: "ea",
  pieces: "ea",
  unit: "ea",
  units: "ea",

  carton: "carton",
  cartons: "carton",
  ctn: "carton",
  ctns: "carton",
  case: "carton",
  cases: "carton",
};

/**
 * Canonical unit code for a raw unit string, or null if we don't recognise it.
 * Callers should fall back to the item's canonical unit on null.
 */
export function canonicalUnitCode(raw: string | null | undefined): string | null {
  const cleaned = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (!cleaned) return null;
  return UNIT_ALIASES[cleaned] ?? null;
}

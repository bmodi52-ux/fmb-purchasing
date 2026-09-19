/**
 * Where each of an item's vendor item descriptions came from (#55).
 *
 * The table records only the wording, the vendor, and who added it when — not
 * the receipt behind it. Rather than add a column that would leave every
 * existing description blank, the source is worked out from what is already
 * there: the expense lines filed against the item that say the same thing,
 * and the item's rename history. That answers the question for old and new
 * descriptions alike.
 */

export type DescriptionRow = {
  id: string;
  vendorId: string | null;
  description: string;
  createdAt: string;
  createdBy: string | null;
};

export type ItemLine = {
  expenseId: string;
  expenseNumber: string | null;
  vendorId: string | null;
  description: string;
  /** The receipt's date, falling back to when it was submitted. */
  date: string | null;
};

export type ItemRename = { oldName: string; newName: string; changedAt: string };

export type DescriptionSource =
  | {
      kind: "receipt";
      /** The most recent expense saying this. */
      latest: ItemLine;
      /** How many expenses say it, the latest included. */
      expenseCount: number;
    }
  | { kind: "rename"; renamedTo: string; renamedAt: string }
  | { kind: "added"; createdBy: string | null; createdAt: string };

/** Mirrors normalize() in expense-matching.ts, which is what matching compares. */
export function normalizeDescription(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function describeSources(
  descriptions: DescriptionRow[],
  lines: ItemLine[],
  renames: ItemRename[]
): Map<string, DescriptionSource> {
  const result = new Map<string, DescriptionSource>();

  for (const d of descriptions) {
    const wording = normalizeDescription(d.description);
    // A vendorless description matches a receipt from anyone, so any vendor's
    // line counts; a vendor's own description only that vendor's.
    const matching = lines.filter(
      (l) => normalizeDescription(l.description) === wording && (d.vendorId === null || l.vendorId === d.vendorId)
    );

    if (matching.length > 0) {
      const latest = matching.reduce((a, b) => ((b.date ?? "") > (a.date ?? "") ? b : a));
      result.set(d.id, {
        kind: "receipt",
        latest,
        expenseCount: new Set(matching.map((l) => l.expenseId)).size,
      });
      continue;
    }

    const rename = d.vendorId === null ? renames.find((r) => normalizeDescription(r.oldName) === wording) : undefined;
    if (rename) {
      result.set(d.id, { kind: "rename", renamedTo: rename.newName, renamedAt: rename.changedAt });
      continue;
    }

    result.set(d.id, { kind: "added", createdBy: d.createdBy, createdAt: d.createdAt });
  }

  return result;
}

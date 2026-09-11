/**
 * What a receipt from a vendor usually is (#49, migration 0054): its usual
 * category, whether the vendor is paid directly or the buyer reimbursed, and
 * whether everything it sells is GST-free or carries GST.
 *
 * Applied on Submit once the vendor is recognised, only where the receipt
 * left a gap or the vendor's own setting is certain — a category read off the
 * receipt is never replaced, and a payee named on the receipt is never
 * overridden.
 */

export type SupplierDefaults = {
  categoryName: string | null;
  payee: "me" | "vendor" | null;
  gstTreatment: "gst_free" | "taxable" | null;
};

export const NO_DEFAULTS: SupplierDefaults = { categoryName: null, payee: null, gstTreatment: null };

export function hasDefaults(d: SupplierDefaults | null | undefined): d is SupplierDefaults {
  return !!d && (d.categoryName !== null || d.payee !== null || d.gstTreatment !== null);
}

type Line = { kind: string; categoryName: string | null; gstApplicable: boolean; lineTotal: number };

/** Lines with the vendor's category and GST treatment applied, and what changed, in words. */
export function applyLineDefaults<T extends Line>(lines: T[], defaults: SupplierDefaults): { lines: T[]; changes: string[] } {
  let categorised = 0;
  let gstChanged = 0;
  const next = lines.map((line) => {
    let updated = line;
    // An unallocated remainder is the app's arithmetic, not a purchase.
    if (line.kind === "unallocated") return line;
    if (defaults.categoryName && !line.categoryName) {
      updated = { ...updated, categoryName: defaults.categoryName };
      categorised++;
    }
    const gst = defaults.gstTreatment === "gst_free" ? false : defaults.gstTreatment === "taxable" ? true : null;
    if (gst !== null && updated.gstApplicable !== gst && line.lineTotal !== 0) {
      updated = { ...updated, gstApplicable: gst };
      gstChanged++;
    }
    return updated;
  });

  const changes: string[] = [];
  if (categorised) changes.push(`${categorised} ${categorised === 1 ? "line" : "lines"} filed under ${defaults.categoryName}`);
  if (gstChanged) {
    changes.push(
      `${gstChanged} ${gstChanged === 1 ? "line" : "lines"} marked ${defaults.gstTreatment === "gst_free" ? "GST-free" : "as including GST"}`
    );
  }
  return { lines: next, changes };
}

export const DEFAULT_PAYEE_LABELS: Record<"me" | "vendor", string> = {
  me: "The person who bought it",
  vendor: "The vendor, directly",
};

export const GST_TREATMENT_LABELS: Record<"gst_free" | "taxable", string> = {
  gst_free: "Everything is GST-free",
  taxable: "Everything includes GST",
};

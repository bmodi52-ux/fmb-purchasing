import type { ExtractedLineItem } from "@/lib/receipt-extraction";

/**
 * A voucher or credit taken off at the till, as a line of its own (#61).
 *
 * A Campbells invoice printed "TOTAL 1498.31", "Customer Voucher 5 74.51",
 * "VISA EFT 1423.80". The reading came back with the printed total and the
 * voucher mentioned only in its note, so the lines added up, the form said
 * everything was accounted for, and the claim was $74.51 more than the card
 * was charged.
 *
 * Asking the model for a different total in prose made it unreliable at
 * reading the lines at all — twice it returned none. So it reports two plain
 * facts instead, `amountCharged` and `deductionDescription`, and the
 * arithmetic happens here: the difference becomes a discount line and the
 * total becomes what was actually paid.
 *
 * GST-free by default. The receipt prints GST on what was bought, not on the
 * voucher, and claiming a credit on a discount would invent one.
 */
export function applyDeduction<
  R extends { total: number | null; lineItems: ExtractedLineItem[]; note: string | null },
>(receipt: R, amountCharged: number | null, deductionDescription: string | null): R {
  if (receipt.total == null || amountCharged == null) return receipt;

  const deduction = Math.round((receipt.total - amountCharged) * 100) / 100;
  // Only a real reduction. A larger "charged" figure is a surcharge the
  // receipt already lists, or a misreading, and either way is not a discount.
  if (deduction <= 0.01) return receipt;

  const line: ExtractedLineItem = {
    description: deductionDescription?.trim() || "Voucher or credit applied",
    kind: "discount",
    quantity: null,
    unitPrice: null,
    lineTotal: -deduction,
    category: null,
    normalizedQuantity: null,
    normalizedUnit: null,
    gstApplicable: false,
  };

  return { ...receipt, total: amountCharged, lineItems: [...receipt.lineItems, line] };
}

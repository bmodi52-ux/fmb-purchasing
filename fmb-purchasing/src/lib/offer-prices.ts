import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError } from "@/lib/errors";

/**
 * Receipts keep offer prices current (#46, migration 0078). The rules live in
 * the database functions, so a submission, an edit and the backfill all apply
 * the same ones: a newer receipt's price becomes the offer's, dated by the
 * receipt; an older one never does; a line whose pack disagrees, a credit and
 * a declined or withdrawn expense never count.
 *
 * Neither function fails what called it. The expense is already saved or
 * decided, and a price that didn't move is reported rather than turned into
 * an error the person can do nothing about.
 */

/** After an expense is submitted, edited or reopened. */
export async function priceOffersFromExpense(
  admin: SupabaseClient,
  expenseId: string,
  userId: string | null = null
): Promise<void> {
  const { error } = await admin.rpc("price_offers_from_expense", { p_expense_id: expenseId });
  if (error) await reportError({ source: "offer-prices", error: error.message, expenseId, userId });
}

/**
 * After expenses are declined or withdrawn: offers still priced from them go
 * back to the price they had before.
 */
export async function restoreOfferPrices(
  admin: SupabaseClient,
  expenseIds: string[],
  userId: string | null = null
): Promise<void> {
  if (expenseIds.length === 0) return;
  const { error } = await admin.rpc("restore_offer_prices", { p_expense_ids: expenseIds });
  if (error) {
    await reportError({ source: "offer-prices", error: error.message, detail: expenseIds.join(", "), userId });
  }
}

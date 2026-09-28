/**
 * The link a receipt line's offer is embedded by (#56).
 *
 * Receipt lines and offers are linked twice: a line points at the offer it was
 * filed against (expense_line_items.pricelist_item_id), and since 0078 an offer
 * points at the receipt line its current price came from
 * (pricelist_items.price_source_line_id). The database API refuses an embed
 * between the two that doesn't say which — "more than one relationship was
 * found" — and the Reports page failed on exactly that. So every such embed
 * names this one: `pricelist_items!${LINE_OFFER} ( … )`.
 */
export const LINE_OFFER = "expense_line_items_pricelist_item_id_fkey";

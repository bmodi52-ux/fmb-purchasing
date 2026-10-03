"use client";

import { SubmitButton } from "@/components/submit-button";
import { formatUnitCost } from "@/lib/pack-description";
import { useActionState, useEffect, useRef, useState } from "react";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import type { OfferFormState } from "../actions";

type Vendor = { id: string; name: string; vendor_number: string | null };

/** A pack size an offer can be for, with what its form needs to say. */
export type OfferPack = {
  id: string;
  title: string;
  /** "Price per box" — what an entered price is for. */
  priceLabel: string;
  /** inner_quantity × pack_count, i.e. how much the whole pack contains. */
  totalQuantity: number;
  unitLabel: string | null;
};

const initialState: OfferFormState = { error: null };

// Fields sit on the bottom of their cell and labels stay on one line, so a
// row of them lines up whatever each is called.
const FIELD = "flex min-w-0 flex-col justify-end gap-1";
const LABEL = "truncate text-support text-ink/60";
const INPUT = "input input-sm w-full text-body text-ink";

/**
 * An offer's fields, laid out as two short rows under its row in the table
 * rather than a form as tall as the screen: opening an offer should not push
 * the others out of sight.
 */
export function OfferForm({
  action,
  itemId,
  packs,
  packSizeId,
  offerId,
  vendorId,
  brand,
  vendorSku,
  storeProductName,
  packPrice,
  comments,
  vendors,
  submitLabel,
  onSaved,
  onCancel,
  footer,
}: {
  action: (prev: OfferFormState, formData: FormData) => Promise<OfferFormState>;
  itemId: string;
  /** Every pack size of the item; with more than one, the offer can be put on another. */
  packs: OfferPack[];
  packSizeId: string;
  offerId?: string;
  vendorId?: string | null;
  brand?: string | null;
  vendorSku?: string | null;
  /** What the store calls it (#43), e.g. as its website shows it. */
  storeProductName?: string | null;
  packPrice?: number | null;
  comments?: string | null;
  vendors: Vendor[];
  submitLabel: string;
  /** Called once a save has gone through, so whatever holds the form can close. */
  onSaved?: () => void;
  onCancel?: () => void;
  /** Shown at the end of the row the Save button is on. Buttons only: it sits inside the form. */
  footer?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, initialState);
  const [packPriceStr, setPackPriceStr] = useState(packPrice != null ? String(packPrice) : "");
  // Held here so the price's label and what it works out to follow the pack
  // chosen, not the pack the offer was on when the page loaded.
  const [packId, setPackId] = useState(packSizeId);
  const pack = packs.find((p) => p.id === packId) ?? packs[0];
  const choosesPack = packs.length > 1;

  // Every result of the action is a new object, so a change of state is a
  // submission that came back; one with no error is a save.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });
  useEffect(() => {
    if (state !== initialState && state.error == null) onSavedRef.current?.();
  }, [state]);

  const price = Number(packPriceStr);
  const costPerUnit =
    price && pack?.totalQuantity ? Math.round((price / pack.totalQuantity) * 10000) / 10000 : null;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <FormResetBoundary>
        <input type="hidden" name="item_id" value={itemId} />
        {offerId && <input type="hidden" name="offer_id" value={offerId} />}
        {!choosesPack && <input type="hidden" name="pack_size_id" value={packId} />}

        {/* Twelve columns on a wide screen: vendor, brand, pack and price on
            the first row, the rest on the second. */}
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-6 lg:grid-cols-12">
          <label className={`${FIELD} col-span-2 sm:col-span-3 lg:col-span-4`}>
            <span className={LABEL}>Vendor</span>
            <select name="vendor_id" defaultValue={vendorId ?? ""} className={INPUT}>
              <option value="">— no vendor —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vendor_number} — {v.name}
                </option>
              ))}
            </select>
          </label>

          <label className={`${FIELD} sm:col-span-3 ${choosesPack ? "lg:col-span-2" : "lg:col-span-3"}`}>
            <span className={LABEL}>Brand</span>
            <input name="brand" defaultValue={brand ?? ""} className={INPUT} />
          </label>

          {choosesPack && (
            <label className={`${FIELD} sm:col-span-3 lg:col-span-3`}>
              <span className={LABEL}>Pack size</span>
              <select name="pack_size_id" value={packId} onChange={(e) => setPackId(e.target.value)} className={INPUT}>
                {packs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className={`${FIELD} ${choosesPack ? "" : "col-span-2"} sm:col-span-3 lg:col-span-3`}>
            <span className={LABEL}>{pack?.priceLabel ?? "Price for the whole pack"}</span>
            <span className="flex items-center gap-2">
              <input
                name="pack_price"
                type="number"
                inputMode="decimal"
                step="any"
                value={packPriceStr}
                onChange={(e) => setPackPriceStr(e.target.value)}
                className={`${INPUT} tabular-nums`}
              />
              {/* What the price works out to per unit, as it is typed. */}
              {costPerUnit != null && (
                <span className="shrink-0 text-support whitespace-nowrap tabular-nums text-ink/60">
                  = {formatUnitCost(costPerUnit, pack?.unitLabel)}
                </span>
              )}
            </span>
          </label>

          <label className={`${FIELD} sm:col-span-2 lg:col-span-2`}>
            <span className={LABEL}>Product code</span>
            <input name="vendor_sku" defaultValue={vendorSku ?? ""} placeholder="on their invoice" className={INPUT} />
          </label>

          <label className={`${FIELD} col-span-2 sm:col-span-4 ${choosesPack ? "lg:col-span-5" : "lg:col-span-6"}`}>
            <span className={LABEL}>Store&apos;s name for it</span>
            <input
              name="store_product_name"
              defaultValue={storeProductName ?? ""}
              placeholder="as their website shows it"
              className={INPUT}
            />
          </label>

          <label className={`${FIELD} col-span-2 sm:col-span-6 ${choosesPack ? "lg:col-span-5" : "lg:col-span-6"}`}>
            <span className={LABEL}>Comments</span>
            <textarea name="comments" defaultValue={comments ?? ""} rows={1} className={INPUT} />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <SubmitButton className="btn btn-primary btn-sm">{submitLabel}</SubmitButton>
            {onCancel && (
              <button type="button" onClick={onCancel} className="btn btn-quiet btn-sm">
                Cancel
              </button>
            )}
          </div>
          {footer && <div className="flex flex-wrap items-center gap-1">{footer}</div>}
        </div>
      </FormResetBoundary>
      {state.error && (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

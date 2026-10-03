"use client";

import { SubmitButton } from "@/components/submit-button";
import { formatUnitCost } from "@/lib/pack-description";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { FormResetBoundary } from "@/components/form-reset-boundary";
import type { OfferFormState } from "../actions";

type Vendor = { id: string; name: string; vendor_number: string | null };
type PackSizeOption = { id: string; label: string };

const initialState: OfferFormState = { error: null };

export function OfferForm({
  action,
  itemId,
  packSizeId,
  offerId,
  totalQuantity,
  innerUnitLabel,
  vendorId,
  brand,
  vendorSku,
  storeProductName,
  packPrice,
  comments,
  vendors,
  packSizes,
  submitLabel,
  priceLabel,
  onSaved,
}: {
  /** What the price is for — "Price per box". */
  priceLabel?: string;
  action: (prev: OfferFormState, formData: FormData) => Promise<OfferFormState>;
  itemId: string;
  packSizeId: string;
  offerId?: string;
  /** When given, the offer can be moved to a different pack size. */
  packSizes?: PackSizeOption[];
  /** inner_quantity × pack_count, i.e. how much the whole pack contains. */
  totalQuantity: number;
  innerUnitLabel: string | null;
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
}) {
  const [state, formAction] = useActionState(action, initialState);
  const [packPriceStr, setPackPriceStr] = useState(packPrice != null ? String(packPrice) : "");

  // Every result of the action is a new object, so a change of state is a
  // submission that came back; one with no error is a save.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  });
  useEffect(() => {
    if (state !== initialState && state.error == null) onSavedRef.current?.();
  }, [state]);

  const costPerUnit = useMemo(() => {
    const price = Number(packPriceStr);
    if (!price || !totalQuantity) return null;
    return Math.round((price / totalQuantity) * 10000) / 10000;
  }, [packPriceStr, totalQuantity]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <FormResetBoundary>
      <input type="hidden" name="item_id" value={itemId} />
      {offerId && <input type="hidden" name="offer_id" value={offerId} />}

      {packSizes && packSizes.length > 1 ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Pack size</span>
          <select name="pack_size_id" defaultValue={packSizeId} className="input">
            {packSizes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="pack_size_id" value={packSizeId} />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Vendor</span>
          <select name="vendor_id" defaultValue={vendorId ?? ""} className="input">
            <option value="">— no vendor —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.vendor_number} — {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Brand</span>
          <input name="brand" defaultValue={brand ?? ""} className="input" />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">
            Vendor&apos;s product code <span className="text-ink/40">(optional)</span>
          </span>
          <input name="vendor_sku" defaultValue={vendorSku ?? ""} placeholder="as printed on their invoice" className="input" />
        </label>

        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-ink/70">
            Store&apos;s name for it <span className="text-ink/40">(optional)</span>
          </span>
          <input
            name="store_product_name"
            defaultValue={storeProductName ?? ""}
            placeholder="e.g. Tilda Pure Basmati Rice 10kg, as their website shows it"
            className="input"
          />
        </label>

        <div className="flex gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <span className="text-ink/70">{priceLabel ?? "Price for the whole pack"}</span>
            <input
              name="pack_price"
              type="number"
              step="any"
              value={packPriceStr}
              onChange={(e) => setPackPriceStr(e.target.value)}
              className="input"
            />
          </label>
          <div className="flex w-36 shrink-0 flex-col gap-1 text-sm">
            <span className="text-ink/70">Works out to</span>
            <div className="input flex items-center bg-ink/[0.03] tabular-nums text-ink/70">
              {costPerUnit != null ? formatUnitCost(costPerUnit, innerUnitLabel) : "—"}
            </div>
          </div>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Comments</span>
        <textarea name="comments" defaultValue={comments ?? ""} rows={2} className="input" />
      </label>

      <SubmitButton className="btn btn-secondary self-start">
        {submitLabel}
      </SubmitButton>
      </FormResetBoundary>
      {state.error && (
        <p className="text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}

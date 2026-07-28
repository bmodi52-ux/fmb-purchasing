"use client";

import { SubmitButton } from "@/components/submit-button";
import { useMemo, useState } from "react";

type Vendor = { id: string; name: string; vendor_number: string | null };
type PackSizeOption = { id: string; label: string };

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
  packPrice,
  comments,
  vendors,
  packSizes,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
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
  packPrice?: number | null;
  comments?: string | null;
  vendors: Vendor[];
  submitLabel: string;
}) {
  const [packPriceStr, setPackPriceStr] = useState(packPrice != null ? String(packPrice) : "");

  const costPerUnit = useMemo(() => {
    const price = Number(packPriceStr);
    if (!price || !totalQuantity) return null;
    return Math.round((price / totalQuantity) * 10000) / 10000;
  }, [packPriceStr, totalQuantity]);

  return (
    <form action={action} className="flex flex-col gap-3">
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

      <div className="grid gap-3 sm:grid-cols-2">
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

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">
            Vendor&apos;s product code <span className="text-ink/40">(optional)</span>
          </span>
          <input name="vendor_sku" defaultValue={vendorSku ?? ""} placeholder="as printed on their invoice" className="input" />
        </label>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-ink/70">Price for the whole pack</span>
            <input
              name="pack_price"
              type="number"
              step="any"
              value={packPriceStr}
              onChange={(e) => setPackPriceStr(e.target.value)}
              className="input"
            />
          </label>
          <div className="flex w-32 flex-col gap-1 text-sm">
            <span className="text-ink/70">Works out to</span>
            <div className="input flex items-center bg-ink/[0.03] font-mono text-ink/70">
              {costPerUnit != null ? `${costPerUnit.toFixed(4)}/${innerUnitLabel ?? ""}` : "—"}
            </div>
          </div>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Comments</span>
        <textarea name="comments" defaultValue={comments ?? ""} rows={2} className="input" />
      </label>

      <SubmitButton className="self-start rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}

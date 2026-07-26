"use client";

import { useMemo, useState } from "react";

type Vendor = { id: string; name: string; vendor_number: string | null };
type Unit = { id: string; code: string; label: string };

export function OfferForm({
  action,
  itemId,
  packSizeId,
  offerId,
  packSize,
  packSizeUnitLabel,
  vendorId,
  brand,
  unitPrice,
  unitPriceUnitId,
  perUnitCostUnitId,
  comments,
  vendors,
  units,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  itemId: string;
  packSizeId: string;
  offerId?: string;
  packSize: number;
  packSizeUnitLabel: string | null;
  vendorId?: string | null;
  brand?: string | null;
  unitPrice?: number | null;
  unitPriceUnitId?: string | null;
  perUnitCostUnitId?: string | null;
  comments?: string | null;
  vendors: Vendor[];
  units: Unit[];
  submitLabel: string;
}) {
  const [unitPriceStr, setUnitPriceStr] = useState(unitPrice != null ? String(unitPrice) : "");

  const perUnitCost = useMemo(() => {
    const u = Number(unitPriceStr);
    if (!u || !packSize) return null;
    return Math.round((u / packSize) * 10000) / 10000;
  }, [unitPriceStr, packSize]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="item_id" value={itemId} />
      <input type="hidden" name="pack_size_id" value={packSizeId} />
      {offerId && <input type="hidden" name="offer_id" value={offerId} />}

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
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-ink/70">Unit price</span>
            <input
              name="unit_price"
              type="number"
              step="any"
              value={unitPriceStr}
              onChange={(e) => setUnitPriceStr(e.target.value)}
              className="input"
            />
          </label>
          <label className="flex w-28 flex-col gap-1 text-sm">
            <span className="text-ink/70">Unit</span>
            <select name="unit_price_unit_id" defaultValue={unitPriceUnitId ?? ""} className="input">
              <option value="">—</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-ink/70">Per-unit cost</span>
            <div className="input flex items-center bg-ink/[0.03] text-ink/70">
              {perUnitCost != null ? `${perUnitCost.toFixed(4)} / ${packSizeUnitLabel ?? ""}` : "—"}
            </div>
          </div>
          <label className="flex w-28 flex-col gap-1 text-sm">
            <span className="text-ink/70">Unit</span>
            <select name="per_unit_cost_unit_id" defaultValue={perUnitCostUnitId ?? ""} className="input">
              <option value="">—</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Comments</span>
        <textarea name="comments" defaultValue={comments ?? ""} rows={2} className="input" />
      </label>

      <button
        type="submit"
        className="self-start rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30"
      >
        {submitLabel}
      </button>
    </form>
  );
}

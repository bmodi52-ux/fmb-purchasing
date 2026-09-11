"use client";

import { useActionState } from "react";
import { updateItemBuying, type ItemBuyingState } from "../price-alert-actions";

/**
 * An item's preferred vendor, its own price alert limits and the price it is
 * expected to cost per unit (#29).
 */
export function BuyingForm({
  itemId,
  canEdit,
  vendors,
  values,
  inherited,
  unitName,
}: {
  itemId: string;
  canEdit: boolean;
  vendors: { id: string; name: string }[];
  values: {
    preferredVendorId: string | null;
    risePercent: string;
    fallPercent: string;
    expectedMin: string;
    expectedMax: string;
  };
  /** The limits that apply when this item sets none, and where they come from. */
  inherited: { rise: number; fall: number; from: "category" | "pricelist" | "mixed" };
  /** "kg", "L", "item" — what the expected price is per. */
  unitName: string;
}) {
  const [state, action, pending] = useActionState<ItemBuyingState, FormData>(updateItemBuying, { status: "idle" });
  const source = inherited.from === "category" ? "its category's" : inherited.from === "pricelist" ? "the Pricelist's" : "the inherited";

  return (
    <form action={action} className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
      <input type="hidden" name="item_id" value={itemId} />

      <label className="flex flex-col gap-1 sm:col-span-2">
        <span className="text-ink/70">Preferred vendor</span>
        <select name="preferred_vendor_id" defaultValue={values.preferredVendorId ?? ""} disabled={!canEdit} className="input">
          <option value="">No preference</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-ink/70">Alert when the price per {unitName} moves more than</legend>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5">
            up
            <input
              name="price_rise_percent"
              defaultValue={values.risePercent}
              placeholder={String(inherited.rise)}
              inputMode="decimal"
              disabled={!canEdit}
              className="input w-20 py-1"
            />
            %
          </label>
          <label className="flex items-center gap-1.5">
            down
            <input
              name="price_fall_percent"
              defaultValue={values.fallPercent}
              placeholder={String(inherited.fall)}
              inputMode="decimal"
              disabled={!canEdit}
              className="input w-20 py-1"
            />
            %
          </label>
        </div>
        <span className="text-xs text-ink/45">
          Blank uses {source} {inherited.rise}% up and {inherited.fall}% down, compared with the last purchase.
        </span>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-ink/70">Expected price per {unitName}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5">
            $
            <input
              name="expected_min_per_unit"
              defaultValue={values.expectedMin}
              placeholder="from"
              inputMode="decimal"
              disabled={!canEdit}
              className="input w-24 py-1"
              aria-label="Lowest expected price"
            />
          </label>
          <span className="text-ink/40">to</span>
          <label className="flex items-center gap-1.5">
            $
            <input
              name="expected_max_per_unit"
              defaultValue={values.expectedMax}
              placeholder="to"
              inputMode="decimal"
              disabled={!canEdit}
              className="input w-24 py-1"
              aria-label="Highest expected price"
            />
          </label>
        </div>
        <span className="text-xs text-ink/45">Optional. A purchase outside it is flagged, whatever it cost last time.</span>
      </fieldset>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-gold px-5 py-2.5 font-medium text-ink hover:bg-gold-deep disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save buying details"}
          </button>
          {state.status !== "idle" && (
            <p role="status" className={`text-sm ${state.status === "error" ? "text-maroon" : "text-palm"}`}>
              {state.message}
            </p>
          )}
        </div>
      )}
    </form>
  );
}

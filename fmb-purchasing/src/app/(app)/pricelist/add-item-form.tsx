"use client";

import { SubmitButton } from "@/components/submit-button";
import { formatUnitCost, priceFieldLabel, unitOptionLabel } from "@/lib/pack-description";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createItem, type CreateItemState } from "./actions";
import { PackFields, type PackFieldValues } from "./pack-fields";

const initialState: CreateItemState = { error: null, success: false };

type Vendor = { id: string; name: string; vendor_number: string | null };
type Category = { id: string; name: string };
type Unit = { id: string; code: string; label: string };

const BLANK_PACK: PackFieldValues = { soldAs: "", innerQuantity: "1", innerUnitId: "", packCount: "1" };

export function AddItemForm({
  vendors,
  categories,
  units,
  onSuccess,
  fixedVendor,
}: {
  vendors: Vendor[];
  categories: Category[];
  units: Unit[];
  onSuccess?: () => void;
  /** When set, the first offer is this vendor's and there is nothing to choose. */
  fixedVendor?: { id: string; name: string };
}) {
  const [state, formAction, pending] = useActionState(createItem, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  const [pack, setPack] = useState<PackFieldValues>(BLANK_PACK);
  // The pack fields keep their own state; a new key is how they start over.
  const [packFieldsKey, setPackFieldsKey] = useState(0);
  const [packPrice, setPackPrice] = useState("");
  const [canonicalUnitId, setCanonicalUnitId] = useState("");

  const totalQuantity = useMemo(() => {
    const inner = Number(pack.innerQuantity);
    const count = Number(pack.packCount);
    if (!inner || !count) return null;
    return Math.round(inner * count * 1000) / 1000;
  }, [pack.innerQuantity, pack.packCount]);

  const costPerUnit = useMemo(() => {
    const price = Number(packPrice);
    if (!price || !totalQuantity) return null;
    return Math.round((price / totalQuantity) * 10000) / 10000;
  }, [packPrice, totalQuantity]);

  const innerUnitLabel = units.find((u) => u.id === (pack.innerUnitId || canonicalUnitId))?.label ?? "";
  const priceLabel = priceFieldLabel({
    innerQuantity: pack.innerQuantity,
    unitLabel: innerUnitLabel,
    packCount: pack.packCount,
    soldLoose: pack.soldAs === "loose",
    packaging: pack.soldAs,
  });

  // Resets local form state in response to the server action's result — an
  // external system, not a derivable value — so an effect is the right tool.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPack(BLANK_PACK);
      setPackFieldsKey((k) => k + 1);
      setPackPrice("");
      setCanonicalUnitId("");
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-ink/70">Item name</span>
          <input name="name" required placeholder="e.g. Chicken Breast" className="input" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Item category</span>
          <select name="category_id" className="input" defaultValue="">
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Measured in</span>
          <select
            name="canonical_unit_id"
            required
            className="input"
            value={canonicalUnitId}
            onChange={(e) => setCanonicalUnitId(e.target.value)}
          >
            <option value="">—</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {unitOptionLabel(u.label)}
              </option>
            ))}
          </select>
          <span className="text-xs text-ink/45">
            Prices show per box or pack, and per this unit — e.g. kg for vegetables, L for milk, item for roti
          </span>
        </label>
      </div>

      <div className="border-t border-ink/10 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/40">First pack size</p>
        <PackFields
          key={packFieldsKey}
          units={units}
          defaults={BLANK_PACK}
          labelName="pack_label"
          sameAsUnitId={canonicalUnitId}
          onChange={setPack}
        />
      </div>

      <div className="border-t border-ink/10 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/40">First vendor offer</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {fixedVendor ? (
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Vendor</span>
              <input type="hidden" name="vendor_id" value={fixedVendor.id} />
              <div className="input flex items-center bg-ink/[0.03] text-ink/80">{fixedVendor.name}</div>
            </div>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">Vendor</span>
              <select name="vendor_id" className="input" defaultValue="">
                <option value="">— no vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.vendor_number} — {v.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">Brand</span>
            <input name="brand" className="input" />
          </label>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">
              Vendor&apos;s product code <span className="text-ink/40">(optional)</span>
            </span>
            <input name="vendor_sku" placeholder="as printed on their invoice" className="input" />
          </label>

          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-ink/70">{priceLabel}</span>
              <input
                name="pack_price"
                type="number"
                step="any"
                value={packPrice}
                onChange={(e) => setPackPrice(e.target.value)}
                className="input"
              />
            </label>
            <div className="flex w-36 flex-col gap-1 text-sm">
              <span className="text-ink/70">Works out to</span>
              <div className="input flex items-center bg-ink/[0.03] font-mono text-ink/70">
                {costPerUnit != null ? formatUnitCost(costPerUnit, innerUnitLabel) : "—"}
              </div>
            </div>
          </div>
        </div>

        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Comments</span>
          <textarea name="comments" rows={2} className="input" />
        </label>
      </div>

      <SubmitButton disabled={pending} className="self-start rounded-md bg-gold px-5 py-2.5 font-medium text-ink hover:bg-gold-deep disabled:opacity-60">
        {pending ? "Adding…" : "Add item"}
      </SubmitButton>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

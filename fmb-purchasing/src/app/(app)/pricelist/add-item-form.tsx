"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { createItem, type CreateItemState } from "./actions";

const initialState: CreateItemState = { error: null, success: false };

type Vendor = { id: string; name: string; vendor_number: string | null };
type Category = { id: string; name: string };
type Unit = { id: string; code: string; label: string };

export function AddItemForm({
  vendors,
  categories,
  units,
  onSuccess,
}: {
  vendors: Vendor[];
  categories: Category[];
  units: Unit[];
  onSuccess?: () => void;
}) {
  const [state, formAction, pending] = useActionState(createItem, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  const [packSize, setPackSize] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [canonicalUnitId, setCanonicalUnitId] = useState("");
  const [packSizeUnitId, setPackSizeUnitId] = useState("");
  const [perUnitCostUnitId, setPerUnitCostUnitId] = useState("");

  const perUnitCost = useMemo(() => {
    const p = Number(packSize);
    const u = Number(unitPrice);
    if (!p || !u) return null;
    return Math.round((u / p) * 10000) / 10000;
  }, [packSize, unitPrice]);

  // Resets local form state in response to the server action's result — an
  // external system, not a derivable value — so an effect is the right tool.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPackSize("1");
      setUnitPrice("");
      setCanonicalUnitId("");
      setPackSizeUnitId("");
      setPerUnitCostUnitId("");
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
          <span className="text-ink/70">Canonical unit (for costing)</span>
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
                {u.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="border-t border-ink/10 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/40">First pack size</p>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-ink/70">Pack size</span>
            <input
              name="pack_size"
              type="number"
              step="any"
              value={packSize}
              onChange={(e) => setPackSize(e.target.value)}
              className="input"
            />
          </label>
          <label className="flex w-28 flex-col gap-1 text-sm">
            <span className="text-ink/70">Unit</span>
            <select
              name="pack_size_unit_id"
              className="input"
              value={packSizeUnitId}
              onChange={(e) => setPackSizeUnitId(e.target.value)}
            >
              <option value="">— use canonical —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="text-ink/70">Label (optional)</span>
            <input name="pack_label" placeholder="e.g. Carton" className="input" />
          </label>
        </div>
      </div>

      <div className="border-t border-ink/10 pt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/40">First vendor offer</p>
        <div className="grid gap-3 sm:grid-cols-2">
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
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">Brand</span>
            <input name="brand" className="input" />
          </label>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-ink/70">Unit price</span>
              <input
                name="unit_price"
                type="number"
                step="any"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="input"
              />
            </label>
            <label className="flex w-28 flex-col gap-1 text-sm">
              <span className="text-ink/70">Unit</span>
              <select name="unit_price_unit_id" className="input" defaultValue="">
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
                {perUnitCost != null ? perUnitCost.toFixed(4) : "—"}
              </div>
            </div>
            <label className="flex w-28 flex-col gap-1 text-sm">
              <span className="text-ink/70">Unit</span>
              <select
                name="per_unit_cost_unit_id"
                className="input"
                value={perUnitCostUnitId || packSizeUnitId || canonicalUnitId}
                onChange={(e) => setPerUnitCostUnitId(e.target.value)}
              >
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

        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Comments</span>
          <textarea name="comments" rows={2} className="input" />
        </label>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-gold px-5 py-2.5 font-medium text-ink hover:bg-gold-deep disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add item"}
      </button>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

"use client";

import { SubmitButton } from "@/components/submit-button";
import { useMemo, useState } from "react";
import { updatePackSize } from "../actions";

type Unit = { id: string; code: string; label: string };

/**
 * Edit form for one pack size. Saving it counts as confirming the contents —
 * the number entered here is what per-unit costs get divided by, so a human
 * having just typed it is exactly the assurance the costing needs.
 */
export function PackSizeForm({
  itemId,
  packSizeId,
  innerQuantity,
  innerUnitId,
  packCount,
  label,
  soldLoose,
  units,
  purchaseCount,
}: {
  itemId: string;
  packSizeId: string;
  innerQuantity: number;
  innerUnitId: string;
  packCount: number;
  label: string | null;
  soldLoose: boolean;
  units: Unit[];
  /** How many recorded purchases would have their per-unit cost restated. */
  purchaseCount: number;
}) {
  const [qty, setQty] = useState(String(innerQuantity));
  const [unitId, setUnitId] = useState(innerUnitId);
  const [count, setCount] = useState(String(packCount));
  const [loose, setLoose] = useState(soldLoose);

  const unitLabel = units.find((u) => u.id === unitId)?.label ?? "";
  const total = useMemo(() => {
    const q = Number(qty);
    const c = Number(count);
    if (!q || !c) return null;
    return Math.round(q * c * 1000) / 1000;
  }, [qty, count]);

  return (
    <form action={updatePackSize} className="flex flex-col gap-3">
      <input type="hidden" name="pack_size_id" value={packSizeId} />
      <input type="hidden" name="item_id" value={itemId} />

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Each holds</span>
          <input
            name="inner_quantity"
            type="number"
            step="any"
            min="0"
            required
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="input w-24"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Unit</span>
          <select
            name="inner_unit_id"
            required
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className="input w-28"
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">How many per pack</span>
          <input
            name="pack_count"
            type="number"
            step="1"
            min="1"
            required
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="input w-28"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-ink/70">Label (optional)</span>
          <input name="label" defaultValue={label ?? ""} placeholder="e.g. 1L x 10 carton" className="input" />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="sold_loose"
          checked={loose}
          onChange={(e) => setLoose(e.target.checked)}
        />
        <span className="text-ink/70">
          Sold loose — bought by the {unitLabel || "unit"} rather than in a pack
        </span>
      </label>

      {total != null && (
        <p className="font-mono text-xs text-ink/50">
          One pack contains {total} {unitLabel}
        </p>
      )}

      {purchaseCount > 0 && (
        <p className="rounded-md bg-gold/10 px-3 py-2 text-xs text-ink/70">
          {purchaseCount} recorded purchase{purchaseCount === 1 ? "" : "s"} use this pack size, so saving will
          recalculate {purchaseCount === 1 ? "its" : "their"} cost per unit. The expenses themselves aren&apos;t
          changed.
        </p>
      )}

      <SubmitButton className="self-start rounded-md border border-ink/15 px-4 py-2 text-sm hover:border-ink/30">
        Save pack size
      </SubmitButton>
    </form>
  );
}

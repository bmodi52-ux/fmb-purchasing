"use client";

import { useState } from "react";
import { describePack, unitName, unitOptionLabel } from "@/lib/pack-description";

type Unit = { id: string; code: string; label: string };

export type PackFieldValues = {
  innerQuantity: string;
  innerUnitId: string;
  packCount: string;
};

/**
 * The inputs that describe one pack size, shared by every form that creates or
 * edits one.
 *
 * Asked as two plain questions — how many are in the pack, and what is each
 * one — rather than "Each holds / Unit / How many per pack", which described
 * the columns instead of the product. The preview underneath shows the pack in
 * exactly the words the rest of the app will use for it.
 */
export function PackFields({
  units,
  defaults,
  labelName = "label",
  defaultLabel,
  defaultSoldLoose = false,
  sameAsUnitId,
  onChange,
}: {
  units: Unit[];
  defaults: PackFieldValues;
  /** The form field the pack's name posts as. */
  labelName?: string;
  defaultLabel?: string | null;
  defaultSoldLoose?: boolean;
  /**
   * When set, the unit may be left blank to mean "the same unit prices are
   * compared per", and this is that unit.
   */
  sameAsUnitId?: string;
  onChange?: (values: PackFieldValues) => void;
}) {
  const [values, setValues] = useState(defaults);
  const [loose, setLoose] = useState(defaultSoldLoose);

  function update(patch: Partial<PackFieldValues>) {
    const next = { ...values, ...patch };
    setValues(next);
    onChange?.(next);
  }

  const unitLabel = units.find((u) => u.id === (values.innerUnitId || sameAsUnitId))?.label ?? null;
  const preview =
    Number(values.innerQuantity) > 0 && Number(values.packCount) > 0
      ? describePack({
          innerQuantity: values.innerQuantity,
          unitLabel,
          packCount: values.packCount,
          soldLoose: loose,
        })
      : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">How many in the pack</span>
          <input
            name="pack_count"
            type="number"
            step="1"
            min="1"
            required
            value={values.packCount}
            onChange={(e) => update({ packCount: e.target.value })}
            className="input w-28"
          />
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Each one is</span>
          <div className="flex gap-2">
            <input
              name="inner_quantity"
              type="number"
              step="any"
              min="0"
              required
              aria-label="Size of each one"
              value={values.innerQuantity}
              onChange={(e) => update({ innerQuantity: e.target.value })}
              className="input w-20"
            />
            <select
              name="inner_unit_id"
              required={sameAsUnitId === undefined}
              aria-label="Unit"
              value={values.innerUnitId}
              onChange={(e) => update({ innerUnitId: e.target.value })}
              className="input w-32"
            >
              {sameAsUnitId !== undefined && <option value="">— same as above —</option>}
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitOptionLabel(u.label)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
          <span className="text-ink/70">
            Name for this pack <span className="text-ink/40">(optional)</span>
          </span>
          <input name={labelName} defaultValue={defaultLabel ?? ""} placeholder="e.g. Carton, Tray" className="input" />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="sold_loose" checked={loose} onChange={(e) => setLoose(e.target.checked)} />
        <span className="text-ink/70">
          Bought loose, not in packs — priced per {unitName(unitLabel) || "unit"}
        </span>
      </label>

      {preview && (
        <p className="text-sm text-ink/60">
          Shows as: <span className="font-medium text-ink">{preview}</span>
        </p>
      )}
    </div>
  );
}

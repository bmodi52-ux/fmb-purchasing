"use client";

import { useState } from "react";
import {
  PACKAGING,
  describePack,
  packagingLabel,
  unitOptionLabel,
  type SoldAs,
} from "@/lib/pack-description";

type Unit = { id: string; code: string; label: string };

export type PackFieldValues = {
  soldAs: SoldAs;
  innerQuantity: string;
  innerUnitId: string;
  packCount: string;
};

/**
 * The inputs that describe one pack size, shared by every form that creates or
 * edits one.
 *
 * It starts from what the thing comes in — loose, a box, a carton — because
 * that is how whoever buys it thinks of it: "a 6 kg box", not "1 × 6 kg".
 * Smaller packs inside are a second, optional step, since most packs have
 * none. The preview underneath shows the pack in exactly the words the rest of
 * the app will use for it.
 *
 * The fields posted are the stored columns, whatever the form showed: a loose
 * pack posts one unit, and a pack with nothing inside posts a count of one.
 */
export function PackFields({
  units,
  defaults,
  labelName = "label",
  defaultLabel,
  sameAsUnitId,
  onChange,
}: {
  units: Unit[];
  defaults: PackFieldValues;
  /** The form field the pack's name posts as. */
  labelName?: string;
  defaultLabel?: string | null;
  /**
   * When set, the unit may be left blank to mean "the unit the item is
   * measured in", and this is that unit.
   */
  sameAsUnitId?: string;
  /** Called with the values the form will post. */
  onChange?: (values: PackFieldValues) => void;
}) {
  const [values, setValues] = useState(defaults);
  const [hasSmallerPacks, setHasSmallerPacks] = useState(Number(defaults.packCount) > 1);

  const loose = values.soldAs === "loose";
  const posted: PackFieldValues = {
    ...values,
    innerQuantity: loose ? "1" : values.innerQuantity,
    packCount: loose || !hasSmallerPacks ? "1" : values.packCount,
  };

  function update(patch: Partial<PackFieldValues>, smaller = hasSmallerPacks) {
    const next = { ...values, ...patch };
    setValues(next);
    const nextLoose = next.soldAs === "loose";
    onChange?.({
      ...next,
      innerQuantity: nextLoose ? "1" : next.innerQuantity,
      packCount: nextLoose || !smaller ? "1" : next.packCount,
    });
  }

  function toggleSmallerPacks(on: boolean) {
    setHasSmallerPacks(on);
    update({}, on);
  }

  const unitLabel = units.find((u) => u.id === (values.innerUnitId || sameAsUnitId))?.label ?? null;
  const container = loose || values.soldAs === "" ? "pack" : values.soldAs;
  const preview =
    Number(posted.innerQuantity) > 0 && Number(posted.packCount) > 0
      ? describePack({
          innerQuantity: posted.innerQuantity,
          unitLabel,
          packCount: posted.packCount,
          soldLoose: loose,
          packaging: loose ? null : values.soldAs || null,
        })
      : null;

  const unitSelect = (
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
  );

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="packaging" value={loose ? "" : values.soldAs} />
      {loose && <input type="hidden" name="sold_loose" value="on" />}
      {(loose || !hasSmallerPacks) && <input type="hidden" name="pack_count" value="1" />}
      {loose && <input type="hidden" name="inner_quantity" value="1" />}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Comes as</span>
          <select
            value={values.soldAs}
            onChange={(e) => update({ soldAs: e.target.value as SoldAs })}
            className="input w-32"
          >
            {values.soldAs === "" && <option value="">— choose —</option>}
            <option value="loose">Loose</option>
            {PACKAGING.map((p) => (
              <option key={p} value={p}>
                {packagingLabel(p)}
              </option>
            ))}
          </select>
        </label>

        {loose ? (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-ink/70">Priced per</span>
            {unitSelect}
          </div>
        ) : (
          <>
            {hasSmallerPacks && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink/70">How many inside</span>
                <input
                  name="pack_count"
                  type="number"
                  step="1"
                  min="1"
                  required
                  value={values.packCount}
                  onChange={(e) => update({ packCount: e.target.value })}
                  className="input w-24"
                />
              </label>
            )}
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-ink/70">{hasSmallerPacks ? "Each one holds" : `Each ${container} holds`}</span>
              <div className="flex gap-2">
                <input
                  name="inner_quantity"
                  type="number"
                  step="any"
                  min="0"
                  required
                  aria-label="Amount"
                  value={values.innerQuantity}
                  onChange={(e) => update({ innerQuantity: e.target.value })}
                  className="input w-20"
                />
                {unitSelect}
              </div>
            </div>
          </>
        )}

        <label className="flex min-w-40 flex-1 flex-col gap-1 text-sm">
          <span className="text-ink/70">
            Name <span className="text-ink/40">(optional)</span>
          </span>
          <input name={labelName} defaultValue={defaultLabel ?? ""} placeholder="e.g. Large box" className="input" />
        </label>
      </div>

      {!loose && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hasSmallerPacks} onChange={(e) => toggleSmallerPacks(e.target.checked)} />
          <span className="text-ink/70">
            Has smaller packs inside — e.g. a carton of 10 × 1 L bottles
          </span>
        </label>
      )}

      {preview && (
        <p className="text-sm text-ink/60">
          Shows as: <span className="font-medium text-ink">{preview}</span>
        </p>
      )}
    </div>
  );
}

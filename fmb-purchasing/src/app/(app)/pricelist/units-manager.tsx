"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { addUnit, type UnitFormState } from "./actions";
import { UNIT_DIMENSIONS, type UnitDimension } from "@/lib/units";

const initialState: UnitFormState = { error: null, success: false };

export type ManagedUnit = {
  id: string;
  code: string;
  label: string;
  dimension: string;
  baseUnitCode: string;
  toBaseFactor: number;
};

const DIMENSION_LABELS: Record<string, string> = {
  mass: "Mass",
  volume: "Volume",
  count: "Count",
  length: "Length",
};

/** A base unit is one that measures itself — everything else converts to it. */
function isBaseUnit(u: ManagedUnit): boolean {
  return u.baseUnitCode === u.code;
}

export function UnitsManager({ units }: { units: ManagedUnit[] }) {
  const [state, formAction] = useActionState(addUnit, initialState);

  const [code, setCode] = useState("");
  const [dimension, setDimension] = useState<UnitDimension>("count");
  const [baseUnitCode, setBaseUnitCode] = useState("");
  const [factor, setFactor] = useState("1");

  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.success) {
      setCode("");
      setBaseUnitCode("");
      setFactor("1");
    }
  }

  // React resets the <form> element once its action resolves. Controlled text
  // inputs survive that, but a controlled <select> does not: the DOM goes back
  // to its default while React state still holds the choice, and because the
  // value prop has not changed there is no re-render to correct it. The two
  // then disagree about what the next submit sends — picking Mass, submitting,
  // and submitting again would have posted "count".
  //
  // Writing React's state back onto the DOM is exactly the "synchronise with
  // an external system" case an effect is for; the form element is the
  // external system here, since React itself mutated it behind our back.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const dimensionField = form.elements.namedItem("dimension");
    const baseField = form.elements.namedItem("base_unit_code");
    if (dimensionField instanceof HTMLSelectElement) dimensionField.value = dimension;
    if (baseField instanceof HTMLSelectElement) baseField.value = baseUnitCode;
  }, [state, dimension, baseUnitCode]);

  // Only genuine base units are offered: converting to a unit that itself
  // converts elsewhere would leave this one a step further from the base than
  // everything it is meant to be compared against.
  const baseOptions = units.filter((u) => u.dimension === dimension && isBaseUnit(u));
  const ownBase = baseUnitCode === "";

  function pickDimension(next: UnitDimension) {
    setDimension(next);
    // The chosen base almost certainly belongs to the old dimension.
    setBaseUnitCode("");
    setFactor("1");
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-ink/10 bg-white/60 p-5 text-sm">
        <h2 className="mb-3 section-title text-ink">All units ({units.length})</h2>

        <div className="flex flex-col gap-4">
          {UNIT_DIMENSIONS.filter((d) => units.some((u) => u.dimension === d)).map((d) => (
            <div key={d}>
              <p className="mb-1 text-xs uppercase tracking-wide text-ink/40">{DIMENSION_LABELS[d]}</p>
              <ul className="flex flex-wrap gap-2">
                {units
                  .filter((u) => u.dimension === d)
                  .map((u) => (
                    <li
                      key={u.id}
                      className="rounded-full bg-ink/5 px-2.5 py-1 text-xs text-ink/70"
                      title={
                        isBaseUnit(u)
                          ? `${u.code} is the base unit for ${d}`
                          : `1 ${u.code} = ${u.toBaseFactor} ${u.baseUnitCode}`
                      }
                    >
                      <span className="font-medium text-ink">{u.label}</span>{" "}
                      {isBaseUnit(u) ? (
                        <span className="text-ink/40">base</span>
                      ) : (
                        <span className="text-ink/40">
                          = {u.toBaseFactor} {u.baseUnitCode}
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-ink/10 bg-white/60 p-5 text-sm">
        <h2 className="mb-1 section-title text-ink">Add a unit</h2>
        <p className="mb-4 max-w-2xl text-xs text-ink/50">
          Two costs are only comparable when both reduce to the same base unit,
          so a new unit has to say what it measures and how it converts.
        </p>

        <form ref={formRef} action={formAction} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/70">Unit</span>
              <input
                name="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. lb"
                className="input h-9 w-32 py-1 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/70">Measures</span>
              <select
                name="dimension"
                value={dimension}
                onChange={(e) => pickDimension(e.target.value as UnitDimension)}
                className="input h-9 w-32 py-1 text-sm"
              >
                {UNIT_DIMENSIONS.map((d) => (
                  <option key={d} value={d}>
                    {DIMENSION_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-ink/70">Converts to</span>
              <select
                name="base_unit_code"
                value={baseUnitCode}
                onChange={(e) => setBaseUnitCode(e.target.value)}
                className="input h-9 w-44 py-1 text-sm"
              >
                <option value="">— its own base unit —</option>
                {baseOptions.map((u) => (
                  <option key={u.id} value={u.code}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>

            {!ownBase && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-ink/70">
                  1 {code || "unit"} = ? {baseUnitCode}
                </span>
                <input
                  name="to_base_factor"
                  value={factor}
                  onChange={(e) => setFactor(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.4536"
                  className="input h-9 w-32 py-1 text-sm"
                />
              </label>
            )}

            <SubmitButton className="h-9 rounded-md border border-ink/15 px-3 text-sm hover:border-ink/30">
              + Add unit
            </SubmitButton>
          </div>

          {ownBase && (
            <p className="text-xs text-ink/50">
              {baseOptions.length === 0
                ? `Nothing measures ${DIMENSION_LABELS[dimension].toLowerCase()} yet, so this unit becomes the base everything else converts to.`
                : `This unit will define its own scale rather than converting to ${baseOptions
                    .map((u) => u.label)
                    .join(" or ")} — costs in it stay separate from those.`}
            </p>
          )}

          {state.error && <p className="text-xs text-red-700">{state.error}</p>}
        </form>
      </section>
    </div>
  );
}

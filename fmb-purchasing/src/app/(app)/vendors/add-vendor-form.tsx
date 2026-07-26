"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import {
  createVendor,
  lookupAbnAction,
  searchVendorSuggestions,
  type CreateVendorState,
  type VendorSuggestion,
} from "./actions";

const initialState: CreateVendorState = { error: null, success: false };

export function AddVendorForm({ onSuccess }: { onSuccess?: () => void }) {
  const [state, formAction, pending] = useActionState(createVendor, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  const [name, setName] = useState("");
  const [abn, setAbn] = useState("");
  const [billingState, setBillingState] = useState("");
  const [billingPostcode, setBillingPostcode] = useState("");

  const [suggestions, setSuggestions] = useState<VendorSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searching, startSearch] = useTransition();
  const [lookingUpAbn, startAbnLookup] = useTransition();
  const [abnNote, setAbnNote] = useState<string | null>(null);

  useEffect(() => {
    if (name.trim().length < 3) return;
    const handle = setTimeout(() => {
      startSearch(async () => {
        setSuggestions(await searchVendorSuggestions(name));
      });
    }, 350);
    return () => clearTimeout(handle);
  }, [name]);

  useEffect(() => {
    const digits = abn.replace(/\D/g, "");
    if (digits.length !== 11) return;
    startAbnLookup(async () => {
      const result = await lookupAbnAction(digits);
      if ("error" in result) {
        setAbnNote(result.error);
      } else {
        setName(result.name);
        setBillingState(result.state ?? "");
        setBillingPostcode(result.postcode ?? "");
        setAbnNote(`Matched: ${result.name}`);
      }
    });
  }, [abn]);

  // Resets local form state in response to the server action's result — an
  // external system, not a derivable value — so an effect is the right tool.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setName("");
      setAbn("");
      setBillingState("");
      setBillingPostcode("");
      setAbnNote(null);
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  function selectSuggestion(s: VendorSuggestion) {
    setName(s.name);
    setAbn(s.abn ?? "");
    setBillingState(s.state ?? "");
    setBillingPostcode(s.postcode ?? "");
    setShowSuggestions(false);
    setAbnNote(
      s.source === "existing"
        ? `Already in Vendors as ${s.vendorNumber}.`
        : `From ABN Lookup — ABN ${s.abn}.`
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="relative flex flex-col gap-1 text-sm">
          <span className="text-ink/70">Vendor name</span>
          <input
            name="name"
            required
            value={name}
            onChange={(e) => {
              const value = e.target.value;
              setName(value);
              setShowSuggestions(true);
              if (value.trim().length < 3) setSuggestions([]);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            autoComplete="off"
            className="input"
          />
          {showSuggestions && (searching || suggestions.length > 0) && (
            <ul className="absolute top-full z-10 mt-1 max-h-56 w-full min-w-72 overflow-y-auto rounded-md border border-ink/15 bg-white text-sm shadow-md">
              {searching && <li className="px-3 py-2 text-ink/40">Searching…</li>}
              {!searching &&
                suggestions.map((s, i) => (
                  <li key={`${s.source}-${s.abn}-${i}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSuggestion(s)}
                      className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-gold/10"
                    >
                      <span className="text-ink">{s.name}</span>
                      <span className="font-mono text-xs text-ink/50">
                        {s.abn ?? "no ABN"} ·{" "}
                        {s.source === "existing" ? `already in Vendors (${s.vendorNumber})` : "ABN Lookup"}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink/70">ABN</span>
          <div className="flex items-center gap-2">
            <input
              name="abn"
              value={abn}
              onChange={(e) => {
                const value = e.target.value;
                setAbn(value);
                if (value.replace(/\D/g, "").length !== 11) setAbnNote(null);
              }}
              className="input flex-1"
            />
            {lookingUpAbn && <span className="text-xs text-ink/40">looking up…</span>}
          </div>
          {abnNote && <span className="text-xs text-ink/50">{abnNote}</span>}
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink/70">Billing address</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <input name="billing_line1" placeholder="Address line 1" className="input sm:col-span-2" />
          <input name="billing_line2" placeholder="Address line 2" className="input sm:col-span-2" />
          <input name="billing_suburb" placeholder="Suburb" className="input" />
          <input
            name="billing_state"
            placeholder="State"
            value={billingState}
            onChange={(e) => setBillingState(e.target.value)}
            className="input"
          />
          <input
            name="billing_postcode"
            placeholder="Postcode"
            value={billingPostcode}
            onChange={(e) => setBillingPostcode(e.target.value)}
            className="input"
          />
          <input name="billing_country" placeholder="Country" defaultValue="Australia" className="input" />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink/70">Collection address</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <input name="collection_label" placeholder="Label (e.g. Warehouse)" className="input sm:col-span-2" />
          <input name="collection_line1" placeholder="Address line 1" className="input sm:col-span-2" />
          <input name="collection_line2" placeholder="Address line 2" className="input sm:col-span-2" />
          <input name="collection_suburb" placeholder="Suburb" className="input" />
          <input name="collection_state" placeholder="State" className="input" />
          <input name="collection_postcode" placeholder="Postcode" className="input" />
          <input name="collection_country" placeholder="Country" defaultValue="Australia" className="input" />
        </div>
        <p className="text-xs text-ink/40">More collection addresses can be added later on the vendor page.</p>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-ink/70">Contact person</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <input name="contact_name" placeholder="Name" className="input" />
          <input name="contact_phone" placeholder="Phone" className="input" />
        </div>
        <p className="text-xs text-ink/40">More contacts can be added later on the vendor page.</p>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md bg-gold px-5 py-2.5 font-medium text-ink hover:bg-gold-deep disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add vendor"}
      </button>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

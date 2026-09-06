"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AnchoredPopover } from "@/components/anchored-popover";
import { searchVendorsAction, type ResolvedVendor, type VendorLookupSuggestion } from "./actions";

export function VendorLookupFields({
  vendorName,
  setVendorName,
  vendorNumber,
  setVendorNumber,
  resolved,
  resolving,
}: {
  vendorName: string;
  setVendorName: (v: string) => void;
  vendorNumber: string;
  setVendorNumber: (v: string) => void;
  /** The vendor already on file that this receipt belongs to, if any. */
  resolved: ResolvedVendor | null;
  resolving: boolean;
}) {
  const [query, setQuery] = useState<{ field: "name" | "number"; text: string } | null>(null);
  const [suggestions, setSuggestions] = useState<VendorLookupSuggestion[]>([]);
  const [open, setOpen] = useState<"name" | "number" | null>(null);
  const [searching, startSearch] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);
  const numberRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!query || query.text.trim().length < 1) return;
    const handle = setTimeout(() => {
      startSearch(async () => {
        setSuggestions(await searchVendorsAction(query.text));
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  function select(s: VendorLookupSuggestion) {
    setVendorName(s.name);
    setVendorNumber(s.vendorNumber ?? "");
    setOpen(null);
  }

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Vendor</span>
        <input
          ref={nameRef}
          value={vendorName}
          onChange={(e) => {
            const value = e.target.value;
            setVendorName(value);
            setQuery({ field: "name", text: value });
            setOpen("name");
            if (value.trim().length < 1) setSuggestions([]);
          }}
          onFocus={() => setOpen("name")}
          onBlur={() => setTimeout(() => setOpen(null), 150)}
          autoComplete="off"
          className="w-full rounded-md border border-ink/15 bg-white px-3 py-2"
        />
        <AnchoredPopover anchorRef={nameRef} open={open === "name" && (searching || suggestions.length > 0)}>
          <SuggestionList suggestions={suggestions} searching={searching} onSelect={select} />
        </AnchoredPopover>
        <VendorMatchNote vendorName={vendorName} resolved={resolved} resolving={resolving} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Vendor # (if known)</span>
        <input
          ref={numberRef}
          value={vendorNumber}
          onChange={(e) => {
            const value = e.target.value;
            setVendorNumber(value);
            setQuery({ field: "number", text: value });
            setOpen("number");
            if (value.trim().length < 1) setSuggestions([]);
          }}
          onFocus={() => setOpen("number")}
          onBlur={() => setTimeout(() => setOpen(null), 150)}
          autoComplete="off"
          placeholder="e.g. 5"
          className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 font-mono"
        />
        <AnchoredPopover anchorRef={numberRef} open={open === "number" && (searching || suggestions.length > 0)}>
          <SuggestionList suggestions={suggestions} searching={searching} onSelect={select} />
        </AnchoredPopover>
      </label>
    </>
  );
}

/**
 * Whether this vendor is already on file.
 *
 * The typeahead only ever ran on a keystroke, so a name filled in by
 * extraction was never looked up: the field sat there looking exactly as it
 * would for a shop nobody had entered, and submitters concluded — reasonably,
 * and as it turned out sometimes correctly — that a duplicate was about to be
 * created. Saying which vendor the submission will be filed against is the
 * whole point; it costs one line and removes the doubt.
 */
function VendorMatchNote({
  vendorName,
  resolved,
  resolving,
}: {
  vendorName: string;
  resolved: ResolvedVendor | null;
  resolving: boolean;
}) {
  if (!vendorName.trim()) return null;
  if (resolving) return <span className="text-xs text-ink/40">Checking Vendors…</span>;

  if (!resolved) {
    return (
      <span className="text-xs text-ink/55">
        Not in Vendors yet — it will be added for review when you submit.
      </span>
    );
  }

  return (
    <span className="text-xs text-palm">
      Matched <span className="font-mono">{resolved.vendorNumber ?? "—"}</span> {resolved.name}
      {resolved.status !== "approved" && <span className="text-ink/50"> · awaiting review</span>}
    </span>
  );
}

function SuggestionList({
  suggestions,
  searching,
  onSelect,
}: {
  suggestions: VendorLookupSuggestion[];
  searching: boolean;
  onSelect: (s: VendorLookupSuggestion) => void;
}) {
  return (
    <ul>
      {searching && <li className="px-3 py-2 text-ink/40">Searching…</li>}
      {!searching &&
        suggestions.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(s)}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gold/10"
            >
              <span className="text-ink">{s.name}</span>
              <span className="font-mono text-xs text-ink/50">{s.vendorNumber}</span>
            </button>
          </li>
        ))}
    </ul>
  );
}

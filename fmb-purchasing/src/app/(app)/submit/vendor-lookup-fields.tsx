"use client";

import { useEffect, useState, useTransition } from "react";
import { searchVendorsAction, type VendorLookupSuggestion } from "./actions";

export function VendorLookupFields({
  vendorName,
  setVendorName,
  vendorNumber,
  setVendorNumber,
}: {
  vendorName: string;
  setVendorName: (v: string) => void;
  vendorNumber: string;
  setVendorNumber: (v: string) => void;
}) {
  const [query, setQuery] = useState<{ field: "name" | "number"; text: string } | null>(null);
  const [suggestions, setSuggestions] = useState<VendorLookupSuggestion[]>([]);
  const [open, setOpen] = useState<"name" | "number" | null>(null);
  const [searching, startSearch] = useTransition();

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
      <label className="relative flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Vendor</span>
        <input
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
        {open === "name" && (searching || suggestions.length > 0) && (
          <SuggestionList suggestions={suggestions} searching={searching} onSelect={select} />
        )}
      </label>

      <label className="relative flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Vendor # (if known)</span>
        <input
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
        {open === "number" && (searching || suggestions.length > 0) && (
          <SuggestionList suggestions={suggestions} searching={searching} onSelect={select} />
        )}
      </label>
    </>
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
    <ul className="absolute top-full z-10 mt-1 max-h-56 w-72 overflow-y-auto rounded-md border border-ink/15 bg-white text-sm shadow-md">
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

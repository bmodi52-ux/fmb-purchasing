"use client";

import { useEffect, useState, useTransition } from "react";
import { searchPricelistItemsAction, type ItemLookupSuggestion } from "./actions";

export function ItemLookupCells({
  itemNumber,
  setItemNumber,
  description,
  setDescription,
  onSelect,
}: {
  itemNumber: string;
  setItemNumber: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  onSelect: (s: ItemLookupSuggestion) => void;
}) {
  const [query, setQuery] = useState<{ field: "number" | "description"; text: string } | null>(null);
  const [suggestions, setSuggestions] = useState<ItemLookupSuggestion[]>([]);
  const [open, setOpen] = useState<"number" | "description" | null>(null);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (!query || query.text.trim().length < 2) return;
    const handle = setTimeout(() => {
      startSearch(async () => {
        setSuggestions(await searchPricelistItemsAction(query.text));
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  function select(s: ItemLookupSuggestion) {
    setItemNumber(s.itemNumber ?? "");
    setDescription(s.description);
    setOpen(null);
    onSelect(s);
  }

  return (
    <>
      <td className="p-1">
        <div className="relative">
          <input
            value={itemNumber}
            onChange={(e) => {
              const value = e.target.value;
              setItemNumber(value);
              setQuery({ field: "number", text: value });
              setOpen("number");
              if (value.trim().length < 2) setSuggestions([]);
            }}
            onFocus={() => setOpen("number")}
            onBlur={() => setTimeout(() => setOpen(null), 150)}
            autoComplete="off"
            placeholder="Item #"
            className="w-20 rounded border border-ink/10 bg-white px-2 py-1 font-mono"
          />
          {open === "number" && (searching || suggestions.length > 0) && (
            <SuggestionList suggestions={suggestions} searching={searching} onSelect={select} />
          )}
        </div>
      </td>
      <td className="p-1">
        <div className="relative">
          <input
            value={description}
            onChange={(e) => {
              const value = e.target.value;
              setDescription(value);
              setQuery({ field: "description", text: value });
              setOpen("description");
              if (value.trim().length < 2) setSuggestions([]);
            }}
            onFocus={() => setOpen("description")}
            onBlur={() => setTimeout(() => setOpen(null), 150)}
            autoComplete="off"
            className="w-48 rounded border border-ink/10 bg-white px-2 py-1"
          />
          {open === "description" && (searching || suggestions.length > 0) && (
            <SuggestionList suggestions={suggestions} searching={searching} onSelect={select} />
          )}
        </div>
      </td>
    </>
  );
}

function SuggestionList({
  suggestions,
  searching,
  onSelect,
}: {
  suggestions: ItemLookupSuggestion[];
  searching: boolean;
  onSelect: (s: ItemLookupSuggestion) => void;
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
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-gold/10"
            >
              <span className="text-ink">
                {s.description}
                {s.brand && <span className="text-ink/40"> ({s.brand})</span>}
              </span>
              <span className="font-mono text-xs text-ink/50">
                {s.itemNumber} {s.packSizeLabel ? `· ${s.packSizeLabel}` : ""} {s.vendorName ? `· ${s.vendorName}` : ""}
              </span>
            </button>
          </li>
        ))}
    </ul>
  );
}

"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { AnchoredPopover } from "@/components/anchored-popover";
import { searchPricelistItemsAction, type ItemLookupSuggestion } from "./actions";

export function ItemLookupCells({
  itemNumber,
  setItemNumber,
  description,
  setDescription,
  onSelect,
  onDescriptionBlur,
  layout = "cells",
}: {
  itemNumber: string;
  setItemNumber: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  onSelect: (s: ItemLookupSuggestion) => void;
  /** Leaving the description, so an unlinked line can be looked for again. */
  onDescriptionBlur?: () => void;
  /** "cells" for the table's two <td>s; "stack" for the card a phone shows. */
  layout?: "cells" | "stack";
}) {
  const [query, setQuery] = useState<{ field: "number" | "description"; text: string } | null>(null);
  const [suggestions, setSuggestions] = useState<ItemLookupSuggestion[]>([]);
  const [open, setOpen] = useState<"number" | "description" | null>(null);
  const [searching, startSearch] = useTransition();
  const numberRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const stacked = layout === "stack";

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

  const numberField = (
    <>
      <input
        ref={numberRef}
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
        aria-label="Item number"
        className={`${stacked ? "w-full" : "w-20"} rounded border border-ink/10 bg-white px-2 py-1 font-mono`}
      />
      <AnchoredPopover anchorRef={numberRef} open={open === "number" && (searching || suggestions.length > 0)}>
        <SuggestionList suggestions={suggestions} searching={searching} onSelect={select} />
      </AnchoredPopover>
    </>
  );

  const descriptionField = (
    <>
      <input
        ref={descriptionRef}
        value={description}
        onChange={(e) => {
          const value = e.target.value;
          setDescription(value);
          setQuery({ field: "description", text: value });
          setOpen("description");
          if (value.trim().length < 2) setSuggestions([]);
        }}
        onFocus={() => setOpen("description")}
        onBlur={() => {
          setTimeout(() => setOpen(null), 150);
          onDescriptionBlur?.();
        }}
        autoComplete="off"
        placeholder={stacked ? "Description" : undefined}
        aria-label="Description"
        className={`${stacked ? "w-full" : "w-48"} rounded border border-ink/10 bg-white px-2 py-1`}
      />
      <AnchoredPopover
        anchorRef={descriptionRef}
        open={open === "description" && (searching || suggestions.length > 0)}
      >
        <SuggestionList suggestions={suggestions} searching={searching} onSelect={select} />
      </AnchoredPopover>
    </>
  );

  if (stacked) {
    return (
      <div className="flex gap-2">
        <div className="w-24 shrink-0">{numberField}</div>
        <div className="min-w-0 flex-1">{descriptionField}</div>
      </div>
    );
  }

  return (
    <>
      <td className="p-1">{numberField}</td>
      <td className="p-1">{descriptionField}</td>
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
    <ul>
      {searching && <li className="px-3 py-2 text-ink/40">Searching…</li>}
      {!searching &&
        suggestions.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(s)}
              className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-gold/10"
            >
              <span className="text-ink">{s.description}</span>
              {s.packSizeLabel && <span className="text-sm text-ink/70">{s.packSizeLabel}</span>}
              <span className="text-xs text-ink/50">
                {[s.itemNumber, s.categoryName].filter(Boolean).join(" · ")}
              </span>
            </button>
          </li>
        ))}
    </ul>
  );
}

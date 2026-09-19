"use client";

import { useId, useMemo, useRef, useState } from "react";
import { AnchoredPopover } from "@/components/anchored-popover";
import { filterVendorOptions, type VendorOption } from "@/lib/vendor-options";
import type { ResolvedVendor } from "./actions";

/**
 * Vendor and Vendor #, each a dropdown of the vendors on file that can still
 * be typed into to search (#59).
 *
 * They were plain text boxes that searched the server once something was
 * typed, so there was nothing to see until you guessed how a vendor was
 * spelled. The approved vendors now come with the page, so the ▾ opens the
 * whole list at once and typing filters it without a round trip; the ones
 * this person submits for most come first. A name that isn't on file can
 * still be typed — the note underneath says it will be added for review.
 */
export function VendorLookupFields({
  vendors,
  vendorName,
  setVendorName,
  vendorNumber,
  setVendorNumber,
  resolved,
  resolving,
}: {
  vendors: VendorOption[];
  vendorName: string;
  setVendorName: (v: string) => void;
  vendorNumber: string;
  setVendorNumber: (v: string) => void;
  /** The vendor already on file that this receipt belongs to, if any. */
  resolved: ResolvedVendor | null;
  resolving: boolean;
}) {
  function select(v: VendorOption) {
    setVendorName(v.name);
    setVendorNumber(v.vendorNumber ?? "");
  }

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Vendor</span>
        <VendorCombobox
          vendors={vendors}
          sortBy="name"
          value={vendorName}
          onType={setVendorName}
          onSelect={select}
          listLabel="Vendors"
          inputClassName=""
        />
        <VendorMatchNote vendorName={vendorName} resolved={resolved} resolving={resolving} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink/70">Vendor # (if known)</span>
        <VendorCombobox
          vendors={vendors}
          sortBy="number"
          value={vendorNumber}
          onType={setVendorNumber}
          onSelect={select}
          listLabel="Vendor numbers"
          placeholder="e.g. 5"
          inputClassName="font-mono"
        />
      </label>
    </>
  );
}

function VendorCombobox({
  vendors,
  sortBy,
  value,
  onType,
  onSelect,
  listLabel,
  placeholder,
  inputClassName,
}: {
  vendors: VendorOption[];
  sortBy: "name" | "number";
  value: string;
  onType: (v: string) => void;
  onSelect: (v: VendorOption) => void;
  listLabel: string;
  placeholder?: string;
  inputClassName: string;
}) {
  const listId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  // What the list is filtered by: what was typed since it opened, or nothing
  // when it was opened with ▾ or into a field that already holds a vendor.
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(0);

  const options = useMemo(() => filterVendorOptions(vendors, filter, sortBy), [vendors, filter, sortBy]);
  const showRecentHeading = filter.trim() === "" && options.some((o) => o.recent) && options.some((o) => !o.recent);

  function openList(withFilter: string) {
    setFilter(withFilter);
    setActive(0);
    setOpen(true);
  }

  function choose(v: VendorOption) {
    onSelect(v);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        openList("");
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (options.length ? (i + step + options.length) % options.length : 0));
    } else if (e.key === "Enter" && open && options[active]) {
      // Picking from the list is what Enter means while it's open; it must
      // not submit the whole expense.
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  }

  const activeId = open && options[active] ? `${listId}-${options[active].id}` : undefined;

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        value={value}
        onChange={(e) => {
          onType(e.target.value);
          openList(e.target.value);
        }}
        onFocus={() => {
          if (!value.trim()) openList("");
        }}
        onClick={() => {
          if (!open && !value.trim()) openList("");
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        placeholder={placeholder}
        className={`w-full rounded-md border border-ink/15 bg-white py-2 pr-9 pl-3 ${inputClassName}`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? `Close ${listLabel.toLowerCase()}` : `Show all ${listLabel.toLowerCase()}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) setOpen(false);
          else {
            openList("");
            inputRef.current?.focus();
          }
        }}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-ink/45 hover:text-ink"
      >
        ▾
      </button>

      <AnchoredPopover anchorRef={wrapperRef} open={open}>
        <ul id={listId} role="listbox" aria-label={listLabel} className="max-h-72 overflow-y-auto py-1">
          {options.length === 0 && (
            <li className="px-3 py-2 text-ink/45">
              {vendors.length === 0 ? "No vendors on file yet." : "No vendor matches — it will be added for review."}
            </li>
          )}
          {options.map((o, i) => (
            <li key={o.id} role="presentation">
              {showRecentHeading && i === 0 && <p className="px-3 pt-1 pb-0.5 text-xs text-ink/40">Recent</p>}
              {showRecentHeading && !o.recent && options[i - 1]?.recent && (
                <p className="mt-1 border-t border-ink/10 px-3 pt-1.5 pb-0.5 text-xs text-ink/40">All vendors</p>
              )}
              <button
                type="button"
                id={`${listId}-${o.id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === active ? "bg-gold/15" : "hover:bg-gold/10"}`}
              >
                {sortBy === "number" ? (
                  <>
                    <span className="w-16 shrink-0 font-mono text-xs text-ink/60">{o.vendorNumber ?? "—"}</span>
                    <span className="min-w-0 truncate text-ink">{o.name}</span>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-ink">{o.name}</span>
                    <span className="shrink-0 font-mono text-xs text-ink/50">{o.vendorNumber}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      </AnchoredPopover>
    </div>
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

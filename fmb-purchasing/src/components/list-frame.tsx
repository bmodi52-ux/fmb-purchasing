"use client";

import type { SelectionApi } from "./filterable-section";

/**
 * A list that is a table where there is room for one and a card for each row
 * where there isn't — Approvals, and My submissions.
 *
 * The list answers to its own width, not the window's: beside a sidebar a
 * laptop has less room than its screen size suggests. From 62rem the rows are
 * the lines of one table, under headings that hold the tick box for "all of
 * these"; narrower, each row is its own card and that tick box has a label.
 */
export function ListFrame({
  columns,
  headings,
  selection,
  rowCount,
  pager,
  children,
}: {
  /** The table's grid, as a `@[62rem]:grid-cols-[…]` class the rows share. Its first track is the tick box. */
  columns: string;
  /** One element for each column after the tick box. */
  headings: React.ReactNode;
  selection: SelectionApi;
  rowCount: number;
  /** From FilterableSection; nothing when the list fits on a page. */
  pager: React.ReactNode;
  /** The rows, each an `<li className={LIST_ROW}>`. */
  children: React.ReactNode;
}) {
  // With a pager under it, "all" can only honestly mean the page in view.
  const selectAllLabel = pager ? "Select all on this page" : `Select all ${rowCount}`;

  return (
    <div className="@container">
      <div className="flex flex-col gap-2.5 @[62rem]:gap-0 @[62rem]:rounded-[0.625rem] @[62rem]:border @[62rem]:border-ink/[0.09] @[62rem]:bg-white @[62rem]:shadow-[0_1px_2px_rgb(43_33_28/0.04)]">
        <div
          className={`hidden items-center gap-x-3.5 border-b border-ink/15 px-[1.2rem] py-2.5 text-support font-semibold text-ink/70 @[62rem]:grid ${columns}`}
        >
          <input
            type="checkbox"
            checked={selection.allShownSelected}
            onChange={selection.toggleAllShown}
            aria-label={selectAllLabel}
            className="size-4"
          />
          {headings}
        </div>

        {/* No headings to hold a tick box until there is a table. */}
        <label className="flex items-center gap-2.5 self-start px-0.5 text-support text-ink/70 @[62rem]:hidden">
          <input
            type="checkbox"
            checked={selection.allShownSelected}
            onChange={selection.toggleAllShown}
            className="size-4"
          />
          {selectAllLabel}
        </label>

        <ul className="flex flex-col gap-2.5 @[62rem]:gap-0">{children}</ul>

        {pager && <div className="@[62rem]:border-t @[62rem]:border-ink/10 @[62rem]:px-[1.2rem] @[62rem]:py-3">{pager}</div>}
      </div>
    </div>
  );
}

/** A row of a ListFrame: a card of its own, until the frame becomes one table and it is a line of that. */
export const LIST_ROW =
  "card p-3.5 @[62rem]:rounded-none @[62rem]:border-0 @[62rem]:border-b @[62rem]:border-ink/[0.06] @[62rem]:bg-transparent @[62rem]:px-[1.2rem] @[62rem]:py-2.5 @[62rem]:shadow-none @[62rem]:last:border-b-0 @[62rem]:hover:bg-gold/[0.06]";

/** The arrow at the end of a row that opens what is under it: a control's size in a card, a row's in the table. */
export function RowDisclosure({
  open,
  onToggle,
  label,
  className = "",
}: {
  open: boolean;
  onToggle: () => void;
  /** What it opens, for a screen reader: "Show the lines of E-0212". */
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={label}
      title={open ? "Hide details" : "Details"}
      className={`btn btn-secondary control aspect-square shrink-0 px-0 text-ink/70 hover:text-ink @[62rem]:h-8 @[62rem]:border-transparent @[62rem]:bg-transparent ${className}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className={`transition-transform ${open ? "rotate-180" : ""}`}
      >
        <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

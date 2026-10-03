"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExportToolbar } from "./export-toolbar";
import { PAGE_SIZES, Pager } from "./pager";
import { useReportPending } from "./pending";
import type { ExportColumn } from "@/lib/export";
import { describeSelection, sumAmounts } from "@/lib/selection-summary";
import { ColumnFilterBar, useColumnFilters, type FilterColumn } from "./column-filter-bar";
import { activeCount, type ColumnFilters } from "./column-filter";

export type SelectionApi = {
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectedCount: number;
  /** Whether every row showing is ticked — for a header tick box (#32). On a paged list, the rows of this page. */
  allShownSelected: boolean;
  /** Tick every row showing, or untick them if they all are. Hidden rows, and other pages, are never touched. */
  toggleAllShown: () => void;
};

export type BulkAction<T> = {
  label: string;
  variant?: "primary" | "danger";
  onClick: (selectedRows: T[]) => void | Promise<void>;
};

/**
 * These pages render cards or their own bespoke table rather than generic
 * columns, so there are no headers to click. The page supplies what it makes
 * sense to sort by instead.
 */
export type SortOption<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number;
};

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const as = String(a ?? "");
  const bs = String(b ?? "");
  if (as === "" && bs !== "") return 1;
  if (bs === "" && as !== "") return -1;
  const an = Number(as);
  const bn = Number(bs);
  if (as !== "" && bs !== "" && !Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
}

export function FilterableSection<T extends Record<string, unknown>>({
  rows,
  searchText,
  columns,
  filenameBase,
  title,
  placeholder = "Filter…",
  getRowId,
  bulkActions,
  selectable,
  amountOf,
  filterValue,
  sortOptions,
  pageKey,
  selectAllButton = true,
  actions,
  children,
}: {
  rows: T[];
  searchText: (row: T) => string;
  columns: ExportColumn[];
  filenameBase: string;
  title: string;
  placeholder?: string;
  getRowId?: (row: T) => string;
  bulkActions?: BulkAction<T>[];
  /**
   * Rows can be ticked even without bulk actions here — Payments ticks rows
   * for its own bar — so Select all is offered too (#32).
   */
  selectable?: boolean;
  /** What one row adds to the selection's total (#69); left out where there is no money. */
  amountOf?: (row: T) => number | null;
  /**
   * What each column holds, so it can be filtered on (#68).
   *
   * These lists own their own table markup — a payment row carries an account
   * status and a Mark paid button that no generic table would render — so the
   * filters cannot sit in the headings the way ColumnsDataTable puts them.
   * They sit above the table instead, one menu per column, and the rows that
   * come out are the rows the page draws.
   *
   * Falls back to reading the column's key off the row, which is what the
   * exports already do, so a list gets filters by saying nothing at all.
   */
  filterValue?: (row: T, columnKey: string) => string | number | null | undefined;
  sortOptions?: SortOption<T>[];
  /**
   * Draw the list a page at a time, 25 rows unless somebody asks for more.
   * The name is what their choice is remembered under in this browser, so
   * each list keeps its own. The page then gets only its rows, and the
   * pager to put at the foot of them.
   */
  pageKey?: string;
  /** Set false where the list has a tick box of its own for "all of these". */
  selectAllButton?: boolean;
  /** What the page is for, at the end of the row of controls: "Review one by one" on Approvals. */
  actions?: (filtered: T[]) => React.ReactNode;
  children: (rows: T[], selection: SelectionApi, pager: React.ReactNode) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // Bulk actions run through onClick rather than a form, so useFormStatus
  // can't see them — report their own busy flag instead.
  useReportPending(busyAction !== null);

  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const rowId = useMemo(
    () => getRowId ?? ((r: T) => String((r as { id?: unknown }).id ?? "")),
    [getRowId]
  );

  const filterColumns: FilterColumn<T>[] = useMemo(
    () =>
      columns.map((column) => ({
        key: column.key,
        label: column.label,
        value: (row: T) =>
          filterValue
            ? filterValue(row, column.key)
            : ((row as Record<string, unknown>)[column.key] as string | number | null | undefined),
      })),
    [columns, filterValue]
  );
  const { filters, setFilters: applyFilters, filtered: byColumn, text: cellText } = useColumnFilters(rows, filterColumns);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = activeCount(filters);

  // Which page, and how long a page is. A list that changes underfoot — a
  // filter typed, a row approved — is shown from the page it still has.
  const top = useRef<HTMLDivElement>(null);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [pageWanted, setPageWanted] = useState(1);
  useEffect(() => {
    if (!pageKey) return;
    try {
      const saved = Number(localStorage.getItem(`fmb.rows.${pageKey}`));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the browser after hydration
      if ((PAGE_SIZES as readonly number[]).includes(saved)) setPageSize(saved);
    } catch {
      // No storage: every list opens at 25.
    }
  }, [pageKey]);
  const setFilters: React.Dispatch<React.SetStateAction<ColumnFilters>> = (next) => {
    applyFilters(next);
    setPageWanted(1);
  };
  function goToPage(next: number) {
    setPageWanted(next);
    // The pager is at the foot, and the next page starts at the top.
    top.current?.scrollIntoView({ block: "start" });
  }
  function choosePageSize(size: number) {
    setPageSize(size);
    setPageWanted(1);
    try {
      if (pageKey) localStorage.setItem(`fmb.rows.${pageKey}`, String(size));
    } catch {
      // Remembering is a convenience; the choice still holds for this visit.
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = q ? byColumn.filter((r) => searchText(r).toLowerCase().includes(q)) : byColumn;


    const option = (sortOptions ?? []).find((o) => o.key === sortKey);
    if (option) {
      // copy first — rows is props
      result = [...result].sort((a, b) => {
        const cmp = compareValues(option.value(a), option.value(b));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byColumn, query, sortKey, sortDir]);

  const pages = pageKey ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1;
  const page = Math.min(pageWanted, pages);
  const shown = pageKey ? filtered.slice((page - 1) * pageSize, page * pageSize) : filtered;

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(rowId(r))), [rows, selected, rowId]);
  const exportSourceRows = selected.size > 0 ? selectedRows : filtered;

  // Everything in view, so a run of routine expenses is one tap rather than a
  // tap per row. Honours the filter and the page: it selects what is showing,
  // not what is hidden behind either.
  const allFilteredSelected = shown.length > 0 && shown.every((r) => selected.has(rowId(r)));
  function toggleAllFiltered() {
    const next = new Set(selected);
    for (const r of shown) {
      if (allFilteredSelected) next.delete(rowId(r));
      else next.add(rowId(r));
    }
    setSelected(next);
  }

  const selection: SelectionApi = {
    isSelected: (id) => selected.has(id),
    toggle: (id) => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
    },
    selectedCount: selected.size,
    allShownSelected: allFilteredSelected,
    toggleAllShown: toggleAllFiltered,
  };

  // A bulk action runs outside a form, so a failure never reaches the error
  // page — without catching it here the click simply appeared to do nothing.
  const [bulkError, setBulkError] = useState<string | null>(null);

  async function runBulkAction(action: BulkAction<T>) {
    setBusyAction(action.label);
    setBulkError(null);
    try {
      await action.onClick(selectedRows);
      setSelected(new Set());
    } catch {
      setBulkError(`"${action.label}" didn't go through. The selection is kept — try again.`);
    } finally {
      setBusyAction(null);
    }
  }

  // Shorter than the smallest page: nothing to page, and no choice to offer.
  const pager =
    pageKey && filtered.length > PAGE_SIZES[0] ? (
      <Pager total={filtered.length} page={page} pageSize={pageSize} onPage={goToPage} onPageSize={choosePageSize} />
    ) : null;

  return (
    <div ref={top} className="flex scroll-mt-20 flex-col gap-4">
      {/* Every control at one height (.control), in one row that wraps: what
          narrows the list on the left, what is done with it on the right. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPageWanted(1);
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="input control w-full text-body sm:w-72"
        />
        {sortOptions && sortOptions.length > 0 && (
          <>
            <select
              value={sortKey}
              onChange={(e) => {
                setSortKey(e.target.value);
                setPageWanted(1);
              }}
              aria-label="Sort by"
              className="input control min-w-0 flex-1 text-body sm:flex-none"
            >
              <option value="">Sort by…</option>
              {sortOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            {sortKey && (
              <button
                type="button"
                onClick={() => {
                  setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                  setPageWanted(1);
                }}
                title={sortDir === "asc" ? "Ascending" : "Descending"}
                className="btn btn-secondary control"
              >
                {sortDir === "asc" ? "▲ asc" : "▼ desc"}
              </button>
            )}
          </>
        )}
        {/* A chip per column was a row of nine before the first record; they
            wait behind one button, as they already did on a phone (#26). */}
        {filterColumns.length > 0 && (
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            className={`btn control ${activeFilters > 0 ? "border-brand/40 bg-brand/[0.08] text-brand" : "btn-secondary"}`}
          >
            {activeFilters > 0 ? `Filters (${activeFilters})` : "Filters"}
          </button>
        )}
        {selectAllButton && (selectable || (bulkActions && bulkActions.length > 0)) && shown.length > 0 && (
          <button type="button" onClick={toggleAllFiltered} className="btn btn-secondary control">
            {allFilteredSelected
              ? "Select none"
              : shown.length < rows.length
                ? `Select all ${shown.length} shown`
                : `Select all (${shown.length})`}
          </button>
        )}
        {filtered.length < rows.length && (
          <span className="text-support tabular-nums text-ink/70">
            {filtered.length} of {rows.length} shown
          </span>
        )}
        {/* On a phone the page's own action wants a full row, and Export shares it;
            with no action, Export sits at the end of the row above. */}
        <div className={`flex items-center gap-2 sm:ml-auto sm:w-auto ${actions ? "w-full" : ""}`}>
          <ExportToolbar filenameBase={filenameBase} title={title} columns={columns} rows={exportSourceRows} inToolbar />
          {actions?.(filtered)}
        </div>
      </div>

      <ColumnFilterBar
        rows={rows}
        columns={filterColumns}
        filters={filters}
        setFilters={setFilters}
        text={cellText}
        open={filtersOpen}
      />

      {selected.size > 0 && bulkActions && bulkActions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-gold/30 bg-gold/10 px-3 py-2 text-body">
          <span className="text-ink/70">
            {describeSelection(
              selected.size,
              amountOf ? sumAmounts(selectedRows.map(amountOf)) : null
            )}
          </span>
          {bulkActions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={busyAction !== null}
              onClick={() => runBulkAction(action)}
              className={
                action.variant === "danger"
                  ? "btn btn-danger btn-sm"
                  : "btn btn-primary btn-sm"
              }
            >
              {busyAction === action.label ? "…" : action.label}
            </button>
          ))}
          <button type="button" onClick={() => setSelected(new Set())} className="text-support text-ink/70 underline hover:text-ink">
            Clear
          </button>
        </div>
      )}

      {bulkError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-body text-danger">
          {bulkError}
        </p>
      )}

      {children(shown, selection, pager)}
    </div>
  );
}

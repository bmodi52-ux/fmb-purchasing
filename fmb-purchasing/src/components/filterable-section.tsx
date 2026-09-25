"use client";

import { useMemo, useState } from "react";
import { ExportToolbar } from "./export-toolbar";
import { useReportPending } from "./pending";
import type { ExportColumn } from "@/lib/export";
import { describeSelection, sumAmounts } from "@/lib/selection-summary";
import { ColumnFilterBar, useColumnFilters, type FilterColumn } from "./column-filter-bar";

export type SelectionApi = {
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectedCount: number;
  /** Whether every row the filters leave showing is ticked — for a header tick box (#32). */
  allShownSelected: boolean;
  /** Tick every row showing, or untick them if they all are. Hidden rows are never touched. */
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
  children: (filtered: T[], selection: SelectionApi) => React.ReactNode;
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
  const { filters, setFilters, filtered: byColumn, text: cellText } = useColumnFilters(rows, filterColumns);

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

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(rowId(r))), [rows, selected, rowId]);
  const exportSourceRows = selected.size > 0 ? selectedRows : filtered;

  // Everything in view, so a run of routine expenses is one tap rather than a
  // tap per row. Honours the filter: it selects what is showing, not what is
  // hidden behind it.
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selected.has(rowId(r)));
  function toggleAllFiltered() {
    const next = new Set(selected);
    for (const r of filtered) {
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="input w-full sm:w-64"
          />
          {sortOptions && sortOptions.length > 0 && (
            <>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                aria-label="Sort by"
                className="input h-9 py-1 text-sm"
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
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  title={sortDir === "asc" ? "Ascending" : "Descending"}
                  className="btn btn-secondary btn-xs"
                >
                  {sortDir === "asc" ? "▲ asc" : "▼ desc"}
                </button>
              )}
            </>
          )}
          {(selectable || (bulkActions && bulkActions.length > 0)) && filtered.length > 0 && (
            <button
              type="button"
              onClick={toggleAllFiltered}
              className="btn btn-secondary btn-sm"
            >
              {allFilteredSelected
                ? "Select none"
                : filtered.length < rows.length
                  ? `Select all ${filtered.length} shown`
                  : `Select all (${filtered.length})`}
            </button>
          )}
        </div>
        <ExportToolbar filenameBase={filenameBase} title={title} columns={columns} rows={exportSourceRows} />
      </div>

      <ColumnFilterBar
        rows={rows}
        columns={filterColumns}
        filters={filters}
        setFilters={setFilters}
        text={cellText}
      />

      {selected.size > 0 && bulkActions && bulkActions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-gold/30 bg-gold/10 px-3 py-2 text-sm">
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
                  ? "btn btn-danger btn-xs"
                  : "btn btn-primary btn-xs"
              }
            >
              {busyAction === action.label ? "…" : action.label}
            </button>
          ))}
          <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-ink/50 hover:text-ink">
            Clear
          </button>
        </div>
      )}

      {bulkError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {bulkError}
        </p>
      )}

      {children(filtered, selection)}
    </div>
  );
}

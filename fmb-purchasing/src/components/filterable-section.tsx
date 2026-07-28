"use client";

import { useMemo, useState } from "react";
import { ExportToolbar } from "./export-toolbar";
import type { ExportColumn } from "@/lib/export";

export type SelectionApi = {
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectedCount: number;
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
  sortOptions?: SortOption<T>[];
  children: (filtered: T[], selection: SelectionApi) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const rowId = useMemo(
    () => getRowId ?? ((r: T) => String((r as { id?: unknown }).id ?? "")),
    [getRowId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = q ? rows.filter((r) => searchText(r).toLowerCase().includes(q)) : rows;

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
  }, [rows, query, sortKey, sortDir]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(rowId(r))), [rows, selected, rowId]);
  const exportSourceRows = selected.size > 0 ? selectedRows : filtered;

  const selection: SelectionApi = {
    isSelected: (id) => selected.has(id),
    toggle: (id) => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelected(next);
    },
    selectedCount: selected.size,
  };

  async function runBulkAction(action: BulkAction<T>) {
    setBusyAction(action.label);
    try {
      await action.onClick(selectedRows);
      setSelected(new Set());
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
                  className="rounded-md border border-ink/15 px-2 py-1 text-xs text-ink/70 hover:border-ink/30"
                >
                  {sortDir === "asc" ? "▲ asc" : "▼ desc"}
                </button>
              )}
            </>
          )}
        </div>
        <ExportToolbar filenameBase={filenameBase} title={title} columns={columns} rows={exportSourceRows} />
      </div>

      {selected.size > 0 && bulkActions && bulkActions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-gold/30 bg-gold/10 px-3 py-2 text-sm">
          <span className="text-ink/70">{selected.size} selected</span>
          {bulkActions.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={busyAction !== null}
              onClick={() => runBulkAction(action)}
              className={
                action.variant === "danger"
                  ? "rounded-md border border-maroon/40 px-3 py-1 text-xs font-medium text-maroon hover:bg-maroon/5 disabled:opacity-50"
                  : "rounded-md bg-gold px-3 py-1 text-xs font-medium text-ink hover:bg-gold-deep disabled:opacity-50"
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

      {children(filtered, selection)}
    </div>
  );
}

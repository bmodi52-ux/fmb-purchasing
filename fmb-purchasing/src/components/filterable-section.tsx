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

export function FilterableSection<T extends Record<string, unknown>>({
  rows,
  searchText,
  columns,
  filenameBase,
  title,
  placeholder = "Filter…",
  getRowId,
  bulkActions,
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
  children: (filtered: T[], selection: SelectionApi) => React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const rowId = useMemo(
    () => getRowId ?? ((r: T) => String((r as { id?: unknown }).id ?? "")),
    [getRowId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => searchText(r).toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query]);

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="input w-64"
        />
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

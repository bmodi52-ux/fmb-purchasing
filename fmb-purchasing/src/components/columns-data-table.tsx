"use client";

import { useMemo, useState, useTransition } from "react";
import { saveColumnPreference } from "@/lib/column-prefs-actions";
import { ExportToolbar } from "./export-toolbar";

export type ColumnDef<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  /** Plain text/number used for search and file exports (render() may return JSX). */
  exportValue: (row: T) => string | number;
};

export type BulkAction<T> = {
  label: string;
  variant?: "primary" | "danger";
  onClick: (selectedRows: T[]) => void | Promise<void>;
};

export function ColumnsDataTable<T extends { id: string }>({
  pageKey,
  title,
  columns,
  rows,
  initialVisible,
  emptyLabel = "None.",
  bulkActions,
}: {
  pageKey: string;
  title: string;
  columns: ColumnDef<T>[];
  rows: T[];
  initialVisible: string[];
  emptyLabel?: string;
  bulkActions?: BulkAction<T>[];
}) {
  const [visible, setVisible] = useState<Set<string>>(new Set(initialVisible));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(key: string) {
    const next = new Set(visible);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setVisible(next);

    const orderedKeys = columns.filter((c) => next.has(c.key)).map((c) => c.key);
    startTransition(() => {
      saveColumnPreference(pageKey, orderedKeys);
    });
  }

  const visibleColumns = columns.filter((c) => visible.has(c.key));

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((c) => String(c.exportValue(row) ?? "").toLowerCase().includes(q))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query]);

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const exportSourceRows = selected.size > 0 ? selectedRows : filteredRows;

  const exportRows = useMemo(
    () =>
      exportSourceRows.map((row) => {
        const out: Record<string, unknown> = {};
        for (const c of columns) out[c.key] = c.exportValue(row);
        return out;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exportSourceRows]
  );

  function toggleRow(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const allVisibleSelected = filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.id));

  function toggleSelectAll() {
    if (allVisibleSelected) {
      const next = new Set(selected);
      for (const r of filteredRows) next.delete(r.id);
      setSelected(next);
    } else {
      const next = new Set(selected);
      for (const r of filteredRows) next.add(r.id);
      setSelected(next);
    }
  }

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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="input w-56"
        />
        <div className="flex items-center gap-3">
          <ExportToolbar
            filenameBase={pageKey}
            title={title}
            columns={columns.map((c) => ({ key: c.key, label: c.label }))}
            rows={exportRows}
          />
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="rounded-md border border-ink/15 px-3 py-1 text-xs text-ink/70 hover:border-ink/30"
            >
              Columns
            </button>
            {open && (
              <div className="absolute top-full right-0 z-10 mt-1 flex max-h-72 w-56 flex-col gap-1 overflow-y-auto rounded-md border border-ink/15 bg-white p-3 text-sm shadow-md">
                {columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2">
                    <input type="checkbox" checked={visible.has(c.key)} onChange={() => toggle(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-gold/30 bg-gold/10 px-3 py-2 text-sm">
          <span className="text-ink/70">{selected.size} selected</span>
          {(bulkActions ?? []).map((action) => (
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

      {filteredRows.length === 0 ? (
        <p className="text-sm text-ink/50">{rows.length === 0 ? emptyLabel : "No rows match this filter."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-ink/60">
                <th className="p-2">
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} aria-label="Select all" />
                </th>
                {visibleColumns.map((c) => (
                  <th key={c.key} className="p-2">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.id} className="border-t border-ink/10">
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleRow(row.id)}
                      aria-label="Select row"
                    />
                  </td>
                  {visibleColumns.map((c) => (
                    <td key={c.key} className="p-2">
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

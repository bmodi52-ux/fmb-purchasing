"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { saveColumnPreference } from "@/lib/column-prefs-actions";
import { ExportToolbar } from "./export-toolbar";

export type ColumnDef<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  /** Plain text/number used for search and file exports (render() may return JSX). */
  exportValue: (row: T) => string | number;
  /**
   * Value to sort by, when the displayed text sorts wrongly — dates rendered
   * as "27/07/2026" being the usual case, where the raw ISO string is needed.
   * Falls back to exportValue.
   */
  sortValue?: (row: T) => string | number;
};

type SortState = { key: string; direction: "asc" | "desc" } | null;

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const as = String(a ?? "");
  const bs = String(b ?? "");
  // blanks last regardless of direction — an empty cell isn't "smallest"
  if (as === "" && bs !== "") return 1;
  if (bs === "" && as !== "") return -1;
  const an = Number(as);
  const bn = Number(bs);
  if (as !== "" && bs !== "" && !Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
  return as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
}

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
  renderExpanded,
}: {
  pageKey: string;
  title: string;
  columns: ColumnDef<T>[];
  rows: T[];
  initialVisible: string[];
  emptyLabel?: string;
  bulkActions?: BulkAction<T>[];
  /** When provided, rows get a chevron that expands an extra detail row in place. */
  renderExpanded?: (row: T) => React.ReactNode;
}) {
  const [visible, setVisible] = useState<Set<string>>(new Set(initialVisible));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [showColumnFilters, setShowColumnFilters] = useState(false);
  const [, startTransition] = useTransition();

  /** Click cycles ascending -> descending -> unsorted. */
  function toggleSort(key: string) {
    setSort((current) => {
      if (current?.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }

  function setColumnFilter(key: string, value: string) {
    setColumnFilters((current) => ({ ...current, [key]: value }));
  }

  const activeColumnFilters = Object.entries(columnFilters).filter(([, v]) => v.trim() !== "");

  function toggleExpanded(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

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
    const columnByKey = new Map(columns.map((c) => [c.key, c]));

    let result = rows;

    if (q) {
      result = result.filter((row) =>
        columns.some((c) => String(c.exportValue(row) ?? "").toLowerCase().includes(q))
      );
    }

    for (const [key, raw] of activeColumnFilters) {
      const column = columnByKey.get(key);
      if (!column) continue;
      const needle = raw.trim().toLowerCase();
      result = result.filter((row) =>
        String(column.exportValue(row) ?? "").toLowerCase().includes(needle)
      );
    }

    if (sort) {
      const column = columnByKey.get(sort.key);
      if (column) {
        const value = column.sortValue ?? column.exportValue;
        // copy first — rows is props, sorting in place would mutate the caller's array
        result = [...result].sort((a, b) => {
          const cmp = compareValues(value(a), value(b));
          return sort.direction === "asc" ? cmp : -cmp;
        });
      }
    }

    return result;
    // columnFilters is replaced wholesale on every edit, so its identity is a
    // sufficient dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, sort, columnFilters]);

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
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          className="input w-full sm:w-56"
        />
        {/* Wraps as one group so the controls stay together on a phone rather
            than scattering across several ragged lines. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => setShowColumnFilters((v) => !v)}
            aria-pressed={showColumnFilters}
            className={`rounded-md border px-3 py-1 text-xs ${
              showColumnFilters || activeColumnFilters.length > 0
                ? "border-gold/50 bg-gold/10 text-ink"
                : "border-ink/15 text-ink/70 hover:border-ink/30"
            }`}
          >
            Filter columns
            {activeColumnFilters.length > 0 && ` (${activeColumnFilters.length})`}
          </button>
          {(activeColumnFilters.length > 0 || sort) && (
            <button
              type="button"
              onClick={() => {
                setColumnFilters({});
                setSort(null);
              }}
              className="text-xs text-ink/50 hover:text-ink"
            >
              Reset
            </button>
          )}
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
                {renderExpanded && <th className="p-2" />}
                {visibleColumns.map((c) => {
                  const sorted = sort?.key === c.key ? sort.direction : null;
                  return (
                    <th key={c.key} className="p-0">
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        title={`Sort by ${c.label}`}
                        className="flex w-full items-center gap-1 p-2 text-left font-medium hover:text-ink"
                      >
                        <span>{c.label}</span>
                        <span className={sorted ? "text-gold-deep" : "text-ink/25"}>
                          {sorted === "asc" ? "▲" : sorted === "desc" ? "▼" : "↕"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
              {showColumnFilters && (
                <tr className="text-left">
                  <th className="p-1" />
                  {renderExpanded && <th className="p-1" />}
                  {visibleColumns.map((c) => (
                    <th key={c.key} className="p-1">
                      <input
                        value={columnFilters[c.key] ?? ""}
                        onChange={(e) => setColumnFilter(c.key, e.target.value)}
                        placeholder={c.label}
                        aria-label={`Filter by ${c.label}`}
                        className="w-full rounded border border-ink/15 bg-white px-2 py-1 text-xs font-normal"
                      />
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <Fragment key={row.id}>
                  <tr className="border-t border-ink/10">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        aria-label="Select row"
                      />
                    </td>
                    {renderExpanded && (
                      <td className="p-2">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(row.id)}
                          aria-label={expanded.has(row.id) ? "Collapse" : "Expand"}
                          className="text-ink/40 hover:text-ink"
                        >
                          {expanded.has(row.id) ? "▾" : "▸"}
                        </button>
                      </td>
                    )}
                    {visibleColumns.map((c) => (
                      <td key={c.key} className="p-2">
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                  {renderExpanded && expanded.has(row.id) && (
                    <tr className="border-t border-ink/5 bg-ink/[0.02]">
                      <td />
                      <td colSpan={visibleColumns.length + 1} className="p-3">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

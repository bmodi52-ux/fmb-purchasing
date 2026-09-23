"use client";

import { useMemo, useState } from "react";
import { ColumnFilterMenu } from "./column-filter-menu";
import { activeCount, isActive, matchesFilter, type ColumnFilters } from "./column-filter";

/**
 * Per-column filters for a table this app draws itself (#68).
 *
 * `ColumnsDataTable` puts a filter menu in every heading, which is the better
 * place for it — but a table with a budget field in one cell and a Mark paid
 * button in another cannot be a generic table, and those are exactly the
 * lists people asked to filter. So the same menus sit in a row above such a
 * table instead, each carrying its column's name, because the menu's own
 * trigger is a bare chevron that only reads correctly under a heading.
 *
 * The matching is the shared module either way, so a ticked value means the
 * same thing wherever it is ticked.
 */

export type FilterColumn<T> = {
  key: string;
  label: string;
  /** What this column holds for a row, as the filter should see it. */
  value: (row: T) => string | number | null | undefined;
};

export function useColumnFilters<T>(rows: readonly T[], columns: readonly FilterColumn<T>[]) {
  const [filters, setFilters] = useState<ColumnFilters>({});

  const text = useMemo(() => {
    const byKey = new Map(columns.map((c) => [c.key, c.value]));
    return (row: T, key: string) => {
      const value = byKey.get(key)?.(row);
      return value == null ? "" : String(value);
    };
  }, [columns]);

  const filtered = useMemo(() => {
    let result = [...rows];
    for (const [key, filter] of Object.entries(filters)) {
      if (!isActive(filter)) continue;
      result = result.filter((row) => matchesFilter(text(row, key), filter));
    }
    return result;
  }, [rows, filters, text]);

  return { filters, setFilters, filtered, text, active: activeCount(filters) };
}

export function ColumnFilterBar<T>({
  rows,
  columns,
  filters,
  setFilters,
  text,
}: {
  rows: readonly T[];
  columns: readonly FilterColumn<T>[];
  filters: ColumnFilters;
  setFilters: React.Dispatch<React.SetStateAction<ColumnFilters>>;
  text: (row: T, key: string) => string;
}) {
  if (columns.length === 0) return null;
  const active = activeCount(filters);

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-ink/60">
      <span className="mr-1 text-ink/45">Filter:</span>
      {columns.map((column) => (
        <span
          key={column.key}
          className={`flex items-center gap-0.5 rounded-md border px-2 py-1 ${
            isActive(filters[column.key]) ? "border-gold-deep bg-gold/10 text-ink" : "border-ink/10 text-ink/55"
          }`}
        >
          {column.label}
          <ColumnFilterMenu
            label={column.label}
            values={rows.map((row) => text(row, column.key))}
            filter={filters[column.key]}
            onChange={(next) =>
              setFilters((current) => {
                const updated = { ...current };
                if (next) updated[column.key] = next;
                else delete updated[column.key];
                return updated;
              })
            }
          />
        </span>
      ))}
      {active > 0 && (
        <button
          type="button"
          onClick={() => setFilters({})}
          className="btn btn-secondary btn-xs ml-1"
        >
          Clear {active} {active === 1 ? "filter" : "filters"}
        </button>
      )}
    </div>
  );
}

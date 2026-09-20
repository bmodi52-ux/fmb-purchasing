"use client";

import { formatDateTime } from "@/lib/format";
import { ColumnFilterBar, useColumnFilters, type FilterColumn } from "@/components/column-filter-bar";

/**
 * The record of backup runs, filterable a column at a time (#68).
 *
 * This is a log: it only grows, and the question asked of it is nearly always
 * a narrowing one — did the receipt backups run this week, which runs had
 * problems, what went to the old destination before it changed. So it shows a
 * few months rather than the last ten rows, and the columns can be filtered.
 */

export type BackupRun = {
  id: string;
  kind: "database" | "receipt_files";
  finishedAt: string;
  itemCount: number;
  newCount: number;
  bytes: number;
  problems: number;
  destination: string | null;
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

const COLUMNS: FilterColumn<BackupRun>[] = [
  { key: "finished", label: "Finished", value: (r) => r.finishedAt.slice(0, 10) },
  { key: "kind", label: "What", value: (r) => (r.kind === "database" ? "Database" : "Receipt files") },
  { key: "problems", label: "Problems", value: (r) => (r.problems > 0 ? `${r.problems} problems` : "none") },
  { key: "destination", label: "Where", value: (r) => r.destination ?? "" },
];

export function BackupRunsTable({ runs }: { runs: BackupRun[] }) {
  const { filters, setFilters, filtered, text, active } = useColumnFilters(runs, COLUMNS);

  return (
    <div className="flex flex-col gap-2">
      <ColumnFilterBar rows={runs} columns={COLUMNS} filters={filters} setFilters={setFilters} text={text} />
      {active > 0 && (
        <p className="text-xs text-ink/45">
          {filtered.length} of {runs.length} runs.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white/60">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs text-ink/55">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Finished</th>
              <th scope="col" className="px-4 py-2 font-medium">What</th>
              <th scope="col" className="px-4 py-2 font-medium">Saved</th>
              <th scope="col" className="px-4 py-2 font-medium">Where</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-ink/5">
                <td className="whitespace-nowrap px-4 py-2">{formatDateTime(r.finishedAt)}</td>
                <td className="px-4 py-2">{r.kind === "database" ? "Database" : "Receipt files"}</td>
                <td className="px-4 py-2 tabular-nums">
                  {r.kind === "database"
                    ? `${r.itemCount.toLocaleString("en-AU")} rows`
                    : `${r.itemCount.toLocaleString("en-AU")} files, ${r.newCount.toLocaleString("en-AU")} new · ${formatBytes(r.bytes)}`}
                  {r.problems > 0 && <span className="ml-2 text-maroon">{r.problems} problems</span>}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-ink/60">{r.destination ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && <p className="text-sm text-ink/50">No runs match this filter.</p>}
    </div>
  );
}

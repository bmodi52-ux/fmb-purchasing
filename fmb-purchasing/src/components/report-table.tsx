"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReportColumn, ReportTable } from "@/lib/reporting/tables";
import { PAGE_SIZE, formatCell, nextSort, pageOfRows, type SortState, type TablePage } from "@/lib/reporting/table-view";

/**
 * A report's table, as every report shows one: headings that sort, pages of
 * fifty, the totals row kept apart, figures aligned to the right.
 *
 * It takes the same table a download is made from (lib/reporting/tables), so
 * what is on the page and what is in the file are one definition.
 *
 * Two ways of working, one look:
 *
 *   in the browser  the whole table is here; sorting and paging are local.
 *                   For tables that are short.
 *   on the server   `server` says the table was sorted and cut to this page
 *                   already (table-view pageOfTable); a heading or the pager
 *                   changes `sort`, `dir` and `page` in the address and the
 *                   server sends the next page. For tables that can be long.
 */
export function ReportTableView({
  table,
  server,
  pageSize = PAGE_SIZE,
  empty = "Nothing to show.",
}: {
  table: ReportTable;
  server?: Omit<TablePage<never>, "rows">;
  pageSize?: number;
  empty?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [local, setLocal] = useState<{ sort: SortState; page: number }>({ sort: null, page: 1 });

  const view = server ?? pageOfRows(table.rows, table.columns, local, pageSize);
  const rows = server ? table.rows : (view as TablePage<(typeof table.rows)[number]>).rows;

  function change(next: { sort?: SortState; page?: number }) {
    if (!server) {
      setLocal((s) => ({ sort: next.sort !== undefined ? next.sort : s.sort, page: next.page ?? 1 }));
      return;
    }
    const params = new URLSearchParams(search.toString());
    if (next.sort !== undefined) {
      params.delete("sort");
      params.delete("dir");
      if (next.sort) {
        params.set("sort", next.sort.key);
        params.set("dir", next.sort.dir);
      }
    }
    params.delete("page");
    if (next.page && next.page > 1) params.set("page", String(next.page));
    const qs = params.toString();
    // The table stays where it is on screen: a sort is not a new page to read from the top.
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  if (view.total === 0) return <p className="text-sm text-ink/55">{empty}</p>;

  const numeric = (c: ReportColumn) => c.kind !== "text" && c.kind !== "date";
  const align = (c: ReportColumn) => (numeric(c) ? "text-right tabular-nums" : "");
  const ariaSort = (c: ReportColumn) =>
    view.sort?.key === c.key ? (view.sort.dir === "asc" ? "ascending" : "descending") : "none";

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs text-ink/55">
              {table.columns.map((c) => (
                <th key={c.key} scope="col" aria-sort={ariaSort(c)} className={`py-2 pr-4 font-medium ${align(c)}`}>
                  <button
                    type="button"
                    onClick={() => change({ sort: nextSort(view.sort, c) })}
                    title={`Sort by ${c.label}`}
                    className="inline-flex items-center gap-1 font-medium hover:text-ink"
                  >
                    {c.label}
                    <span aria-hidden="true" className={view.sort?.key === c.key ? "text-ink" : "text-ink/25"}>
                      {view.sort?.key === c.key ? (view.sort.dir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-ink/5 align-top last:border-0">
                {table.columns.map((c) => {
                  const text = formatCell(r[c.key], c);
                  const href = c.link ? r[c.link] : null;
                  const tone = c.tone && r[c.tone] === "danger" ? "text-danger" : "";
                  return (
                    <td
                      key={c.key}
                      className={`py-1.5 pr-4 ${align(c)} ${c.kind === "date" ? "tabular-nums text-ink/60" : ""} ${
                        // A date, a figure or an entry number is read whole: never broken across lines.
                        c.kind !== "text" || c.link ? "whitespace-nowrap" : ""
                      } ${tone}`}
                    >
                      {typeof href === "string" && href ? (
                        <Link href={href} className="tabular-nums font-medium underline-offset-2 hover:underline">
                          {text || "View"}
                        </Link>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {table.totals && (
              <tr className="border-t border-ink/15 font-medium">
                {table.columns.map((c) => (
                  <td key={c.key} className={`py-2 pr-4 ${align(c)}`}>
                    {table.totals![c.key] == null || table.totals![c.key] === "" ? "" : formatCell(table.totals![c.key], c)}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {view.pages > 1 && (
        <nav aria-label={`${table.title} pages`} className="flex flex-wrap items-center gap-3 text-xs text-ink/60">
          <span className="tabular-nums">
            {view.from.toLocaleString("en-AU")}–{view.to.toLocaleString("en-AU")} of {view.total.toLocaleString("en-AU")}
          </span>
          <button
            type="button"
            onClick={() => change({ page: view.page - 1 })}
            disabled={view.page <= 1}
            className="rounded-full border border-ink/15 px-3 py-1 hover:border-ink/30 hover:text-ink disabled:opacity-40"
          >
            Previous
          </button>
          <span className="tabular-nums">
            Page {view.page} of {view.pages}
          </span>
          <button
            type="button"
            onClick={() => change({ page: view.page + 1 })}
            disabled={view.page >= view.pages}
            className="rounded-full border border-ink/15 px-3 py-1 hover:border-ink/30 hover:text-ink disabled:opacity-40"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

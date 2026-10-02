"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReportColumn, ReportTable } from "@/lib/reporting/tables";
import { PAGE_SIZE, formatCell, nextSort, pageOfRows, type SortState, type TablePage } from "@/lib/reporting/table-view";
import { StatusBadge } from "./status-badge";

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

  if (view.total === 0) return <p className="text-body text-ink/60">{empty}</p>;

  const numeric = (c: ReportColumn) => c.kind !== "text" && c.kind !== "date";
  const align = (c: ReportColumn) => (numeric(c) ? "text-right tabular-nums" : "");
  const ariaSort = (c: ReportColumn) =>
    view.sort?.key === c.key ? (view.sort.dir === "asc" ? "ascending" : "descending") : "none";

  // A table of two or three columns is a list of names with a figure each.
  // Stretched across a wide card the figure sits a hand's width from its
  // name; held to a readable measure, the eye can follow a row.
  const measure = table.columns.length <= 3 ? "max-w-xl" : table.columns.length <= 5 ? "max-w-4xl" : "";

  return (
    <div className={`flex flex-col gap-3 ${measure}`}>
      <div className="overflow-x-auto">
        <table className="min-w-full text-body">
          <thead>
            <tr className="border-b border-ink/15 text-left text-support text-ink/70">
              {table.columns.map((c) => {
                const sorted = view.sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" aria-sort={ariaSort(c)} className={`col-head pr-4 pb-2.5 font-semibold last:pr-0 ${align(c)}`}>
                    <button
                      type="button"
                      onClick={() => change({ sort: nextSort(view.sort, c) })}
                      title={`Sort by ${c.label}`}
                      className={`inline-flex items-center gap-1 font-semibold hover:text-ink ${sorted ? "text-ink" : ""}`}
                    >
                      {c.label}
                      {/* The mark of the column the table is sorted by stays;
                          the others show when their heading is pointed at (#26). */}
                      <span aria-hidden="true" className={sorted ? "text-ink" : "col-hint font-normal text-ink/40"}>
                        {sorted ? (view.sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-ink/[0.06] align-top last:border-0 hover:bg-gold/[0.07]">
                {table.columns.map((c) => {
                  const text = formatCell(r[c.key], c);
                  const href = c.link ? r[c.link] : null;
                  const danger = !!c.tone && r[c.tone] === "danger";
                  return (
                    <td
                      key={c.key}
                      className={`py-2.5 pr-4 last:pr-0 ${align(c)} ${c.kind === "date" ? "tabular-nums text-ink/70" : ""} ${
                        // A date, a figure or an entry number is read whole: never broken across lines.
                        c.kind !== "text" || c.link || c.badge ? "whitespace-nowrap" : ""
                      }`}
                    >
                      {typeof href === "string" && href ? (
                        <Link href={href} className="font-medium text-brand tabular-nums underline-offset-[3px] hover:underline">
                          {text || "View"}
                        </Link>
                      ) : c.badge && text ? (
                        // A status, said and coloured as it is on every other page.
                        <span className="-my-0.5 inline-block">
                          <StatusBadge status={String(r[c.badge] ?? "")} label={text} />
                        </span>
                      ) : danger && text ? (
                        // Too long, too late, over: marked so it is seen in a column of plain figures.
                        <span className="badge badge-bad -my-0.5">{text}</span>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {table.totals && (
              <tr className="border-t border-ink/20 font-semibold">
                {table.columns.map((c) => (
                  <td key={c.key} className={`pt-2.5 pr-4 pb-1 last:pr-0 ${align(c)}`}>
                    {table.totals![c.key] == null || table.totals![c.key] === "" ? "" : formatCell(table.totals![c.key], c)}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {view.pages > 1 && (
        <nav aria-label={`${table.title} pages`} className="flex flex-wrap items-center justify-between gap-3 text-support text-ink/70">
          <span className="tabular-nums">
            {view.from.toLocaleString("en-AU")}–{view.to.toLocaleString("en-AU")} of {view.total.toLocaleString("en-AU")}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => change({ page: view.page - 1 })} disabled={view.page <= 1} className="btn btn-secondary btn-sm">
              Previous
            </button>
            <span className="tabular-nums">
              Page {view.page} of {view.pages}
            </span>
            <button
              type="button"
              onClick={() => change({ page: view.page + 1 })}
              disabled={view.page >= view.pages}
              className="btn btn-secondary btn-sm"
            >
              Next
            </button>
          </span>
        </nav>
      )}
    </div>
  );
}

import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePeriod } from "@/lib/periods";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { standardFilters } from "@/lib/reporting/filters";
import type { ReportDefinition } from "@/lib/reporting/registry";
import { pageOfTable, tableStateFrom } from "@/lib/reporting/table-view";
import { DownloadLinks } from "@/components/download-links";
import { ReportTableView } from "@/components/report-table";
import { ReportFilterBar } from "../report-filter-bar";
import { ReportHeader } from "../report-header";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** What belongs to one table's view, and so is dropped when another table is chosen. */
const TABLE_STATE = ["table", "sort", "dir", "page"];

/**
 * A report as a page, from its registry entry alone: the shared header, the
 * filters it takes, its downloads, and its tables — one at a time, sorted and
 * cut to a page on the server.
 *
 * This is what makes a new report an entry in the registry and nothing more:
 * say what it is, which filters it takes and how its tables are built, and it
 * has a page here, a link, three download formats and widgets-to-be. A report
 * that wants charts or its own layout still writes its own page.
 */
export async function RegistryReport({ user, definition, params }: { user: CurrentUser; definition: ReportDefinition; params: Params }) {
  const today = todayIso();
  const [doc, earliest] = await Promise.all([definition.build(params, today), earliestExpenseDate(createAdminClient())]);

  const period = parsePeriod(one(params.period) ?? definition.defaultPeriod, today);
  const selected = standardFilters(params);

  const chosen = Number.parseInt(one(params.table) ?? "0", 10);
  const index = Number.isInteger(chosen) && chosen >= 0 && chosen < doc.tables.length ? chosen : 0;
  const current = doc.tables[index];
  const paged = current ? pageOfTable(current, tableStateFrom(params)) : null;

  // The address as it is, less whichever table is showing: what a table's
  // tab and the download both start from.
  const carried = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (TABLE_STATE.includes(key) || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) carried.append(key, v);
  }
  const tableHref = (i: number) => {
    const next = new URLSearchParams(carried);
    if (i > 0) next.set("table", String(i));
    const qs = next.toString();
    return qs ? `/reports/${definition.key}?${qs}` : `/reports/${definition.key}`;
  };
  const exported = new URLSearchParams(carried);
  exported.set("report", definition.key);

  return (
    <div className="flex flex-col gap-5">
      <ReportHeader report={definition.key} user={user} title={doc.title} basis={doc.subtitle} />

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-ink/10">
        <nav aria-label="Tables" className="tabs border-b-0">
          {doc.tables.map((t, i) => (
            <Link key={t.title} href={tableHref(i)} aria-current={i === index ? "page" : undefined} className="tab">
              {t.title}
            </Link>
          ))}
        </nav>
        <div className="pb-2">
          <DownloadLinks href={`/reports/export?${exported}`} />
        </div>
      </div>

      <ReportFilterBar
        filters={definition.filters}
        period={period.code}
        today={today}
        earliest={earliest}
        options={doc.filterOptions}
        selected={{ vendors: selected.vendors, categories: selected.categories, items: selected.items }}
        counting={selected.status}
      />

      {paged ? (
        <section className="card p-4">
          <h2 className="section-title text-ink">{paged.table.title}</h2>
          <p className="mt-0.5 text-xs text-ink/50">
            {paged.view.total.toLocaleString("en-AU")} {paged.view.total === 1 ? "row" : "rows"} — select a heading to sort
          </p>
          <div className="mt-3">
            <ReportTableView table={paged.table} server={paged.view} />
          </div>
        </section>
      ) : (
        <p className="card px-4 py-8 text-center text-sm text-ink/55">Nothing in this report.</p>
      )}
    </div>
  );
}

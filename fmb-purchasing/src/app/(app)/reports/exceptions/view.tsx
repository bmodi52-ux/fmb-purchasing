import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { userCan } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { describeBasis } from "@/lib/reporting/basis";
import { loadExceptionsView } from "@/lib/reporting/exceptions-data";
import { findReport } from "@/lib/reporting/registry";
import { DownloadLinks } from "@/components/download-links";
import { ReportFilterBar } from "../report-filter-bar";
import { ReportHeader } from "../report-header";

type Params = Record<string, string | string[] | undefined>;

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const signed = (n: number) => (n > 0 ? `+${money(n)}` : money(n));

/**
 * What in a period's spend is wrong, or may be, with the money attached
 * (reports overhaul, P3). Needs attention is the list to work through; this
 * is the same question asked of a period, to be answered before its figures
 * are relied on.
 */
export async function ExceptionsReport({ user, params }: { user: CurrentUser; params: Params }) {
  const today = todayIso();
  const admin = createAdminClient();
  const [{ period, report, filters, options }, earliest, canGst, canQueue] = await Promise.all([
    loadExceptionsView(admin, params, today),
    earliestExpenseDate(admin),
    userCan(user, "accounting", "view"),
    userCan(user, "review_queue", "view"),
  ]);

  const found = report.groups.filter((g) => g.rows.length > 0);
  const clear = report.groups.filter((g) => g.rows.length === 0);
  const share = report.spend > 0 ? Math.round((report.flaggedSpend / report.spend) * 100) : 0;

  // The download is the page: the same period, filters and basis.
  const exported = new URLSearchParams({ report: "exceptions", period: period.code });
  for (const v of filters.vendors) exported.append("vendor", v);
  for (const c of filters.categories) exported.append("category", c);
  if (filters.status !== "spend") exported.set("status", filters.status);

  return (
    <div className="flex flex-col gap-5">
      <ReportHeader
        report="exceptions"
        user={user}
        basis={describeBasis(filters.status)}
        description={
          <>
            {findReport("exceptions")!.description}
            {canQueue && (
              <>
                {" "}
                To work through them, use{" "}
                <Link href="/review-queue" className="underline underline-offset-2">
                  Needs attention
                </Link>
                .
              </>
            )}
          </>
        }
      />

      <ReportFilterBar
        filters={findReport("exceptions")!.filters}
        period={period.code}
        today={today}
        earliest={earliest}
        options={options}
        selected={{ vendors: filters.vendors, categories: filters.categories }}
        counting={filters.status}
      >
        <div className="ml-auto pb-1">
          <DownloadLinks href={`/reports/export?${exported}`} />
        </div>
      </ReportFilterBar>
      {filters.categories.length > 0 && (
        <p className="-mt-3 text-xs text-ink/55">
          Narrowed to receipts with a line in the chosen categories. Checks on a line list only those lines; checks on a
          whole receipt — its total, its GST, its date — list the receipt.
        </p>
      )}

      <dl className="grid gap-3 sm:grid-cols-3">
        <Tile
          label="Expenses with something to check"
          value={`${report.flaggedExpenses} of ${report.expenseCount}`}
          hint={period.label}
        />
        <Tile label="Their spend" value={money(report.flaggedSpend)} hint={`${share}% of ${money(report.spend)}`} />
        <Tile label="Checks with nothing to report" value={`${clear.length} of ${report.groups.length}`} />
      </dl>

      {found.length === 0 ? (
        <p className="rounded-xl border border-palm/30 bg-palm/5 px-4 py-8 text-center text-sm text-ink/70">
          Nothing to check in {period.label}.
        </p>
      ) : (
        found.map((g) => (
          <section key={g.kind} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h2 className="section-title text-ink">{g.heading}</h2>
              <span className="tabular-nums text-sm text-ink/60">
                {g.rows.length} · {money(g.amount)}
              </span>
            </div>
            <p className="mt-0.5 max-w-2xl text-xs text-ink/55">{g.why}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-ink/10 text-left text-xs text-ink/55">
                    <th scope="col" className="py-2 pr-4 font-medium">Entry</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Date</th>
                    <th scope="col" className="py-2 pr-4 font-medium">Vendor</th>
                    <th scope="col" className="py-2 pr-4 font-medium">What</th>
                    <th scope="col" className="py-2 text-right font-medium">{g.amountLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={`${r.expenseId}-${i}`} className="border-b border-ink/5 align-top last:border-0">
                      <td className="py-1.5 pr-4 whitespace-nowrap">
                        <Link href={`/expenses/${r.expenseId}`} className="tabular-nums font-medium underline-offset-2 hover:underline">
                          {r.entry ?? "View"}
                        </Link>
                        {r.status === "submitted" && <span className="ml-1.5 text-xs text-ink/45">not yet approved</span>}
                      </td>
                      <td className="py-1.5 pr-4 whitespace-nowrap tabular-nums text-ink/60">{formatDate(r.date)}</td>
                      <td className="py-1.5 pr-4">{r.vendor}</td>
                      <td className="py-1.5 pr-4 text-ink/75">{r.detail}</td>
                      <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
                        {g.signed ? signed(r.amount) : money(r.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {found.length > 0 && clear.length > 0 && (
        <section className="card p-4">
          <h2 className="section-title text-ink">Nothing to report</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-ink/65">
            {clear.map((g) => (
              <li key={g.kind}>{g.heading}</li>
            ))}
          </ul>
        </section>
      )}

      {canGst && (
        <p className="text-xs text-ink/55">
          GST claims that may lack a tax invoice, or were charged by a vendor not registered for GST, are on the{" "}
          <Link href="/accounting" className="underline underline-offset-2">
            GST page
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <dt className="text-xs text-ink/55">{label}</dt>
      <dd className="mt-0.5 tabular-nums text-xl font-semibold text-ink">{value}</dd>
      {hint && <dd className="text-xs text-ink/45">{hint}</dd>}
    </div>
  );
}

import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { MONEY_OUT_SECTIONS, loadMoneyOutView, type MoneyOutSection } from "@/lib/reporting/money-out-view";
import {
  paidByMonthTable,
  paidByPayeeTable,
  pipelineByMonthTable,
  timingTable,
  transfersTable,
  waitingBandsTable,
  waitingByPayeeTable,
  waitingListTable,
  type Waiting,
} from "@/lib/reporting/money-out";
import { DownloadLinks } from "@/components/download-links";
import { ReportTableView } from "@/components/report-table";
import { ReportTile as Tile, ReportTiles } from "@/components/report-tile";
import { ReportFilterBar } from "../report-filter-bar";
import { ReportHeader } from "../report-header";

type Params = Record<string, string | string[] | undefined>;

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const days = (n: number | null) => (n === null ? "—" : `${n} ${n === 1 ? "day" : "days"}`);

/** What each section counts, and as of when — the line under the title. */
const BASIS: Record<MoneyOutSection, string> = {
  paid: "By payment date · paid",
  waiting: "As of today · approved and not yet paid",
  pipeline: "Decisions and payments in the period · what is waiting, as of today",
};

/**
 * What has left the account, what is waiting to, and how long each step
 * takes (reports overhaul, P3). Payee names, never bank details: this page is
 * for everyone who can see Reports, and account numbers stay on Payments.
 *
 * Laid out as every report is: its sections are one control in the filter
 * row, its figures are tiles, and its short tables — ages, steps, payees —
 * sit side by side on a wide screen, with the long list under them.
 */
export async function MoneyOutReport({ user, params }: { user: CurrentUser; params: Params }) {
  const today = todayIso();
  const admin = createAdminClient();
  const [view, earliest] = await Promise.all([loadMoneyOutView(admin, params, today), earliestExpenseDate(admin)]);

  const periodCode = "period" in view ? view.period.code : null;
  // The period and the vendors chosen carry from one section to the next, and into the download.
  const carried = new URLSearchParams();
  if (periodCode) carried.set("period", periodCode);
  for (const v of view.vendors) carried.append("vendor", v);
  const sectionHref = (s: MoneyOutSection) => `/reports/money-out?section=${s}${carried.size ? `&${carried}` : ""}`;
  const exportHref = `/reports/export?report=money-out&section=${view.section}${carried.size ? `&${carried}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <ReportHeader report="money-out" user={user} basis={BASIS[view.section]} actions={<DownloadLinks href={exportHref} />} />

      <ReportFilterBar
        filters={periodCode ? ["period", "vendor"] : ["vendor"]}
        period={periodCode ?? undefined}
        today={today}
        earliest={earliest}
        options={{ vendors: view.vendorOptions }}
        selected={{ vendors: view.vendors }}
        lead={
          <div className="flex flex-col gap-1 text-support">
            <span className="font-medium text-ink/70">Section</span>
            <nav aria-label="Money out sections" className="segmented flex-wrap self-start">
              {MONEY_OUT_SECTIONS.map((s) => (
                <Link key={s.key} href={sectionHref(s.key)} aria-current={view.section === s.key ? "page" : undefined} className="segment py-[0.4rem]">
                  {s.label}
                </Link>
              ))}
            </nav>
          </div>
        }
      />

      {view.section === "paid" && (
        <>
          <ReportTiles count={4}>
            <Tile label="Paid" value={money(view.report.total)} hint={view.period.label} />
            <Tile label="Transfers" value={String(view.report.transfers.length)} hint="Payment runs, and expenses paid on their own" />
            <Tile label="Expenses paid" value={String(view.report.expenseCount)} />
            <Tile
              label="Not yet on a bank statement"
              value={money(view.report.unconfirmed.amount)}
              hint={`${view.report.unconfirmed.count} ${view.report.unconfirmed.count === 1 ? "expense" : "expenses"}`}
            />
          </ReportTiles>
          {view.report.transfers.length === 0 ? (
            <Empty>Nothing was paid in {view.period.label}.</Empty>
          ) : (
            <>
              <Panel title="Transfers" subtitle="Newest first">
                <ReportTableView table={transfersTable(view.report)} />
              </Panel>
              <SideBySide>
                <Panel title="By payee">
                  <ReportTableView table={paidByPayeeTable(view.report)} />
                </Panel>
                {view.report.byMonth.length > 1 && (
                  <Panel title="By month">
                    <ReportTableView table={paidByMonthTable(view.report)} />
                  </Panel>
                )}
              </SideBySide>
            </>
          )}
        </>
      )}

      {view.section === "waiting" &&
        (view.report.count === 0 ? (
          <AllClear>Nothing is waiting for payment.</AllClear>
        ) : (
          <>
            <ReportTiles count={3}>
              <Tile label="Awaiting payment" value={money(view.report.amount)} />
              <Tile label="Expenses" value={String(view.report.count)} />
              <Tile label="Oldest" value={days(view.report.oldestDays)} hint="Since approval" />
            </ReportTiles>
            <SideBySide>
              <WaitingBands waiting={view.report} noun="payment" />
              {view.report.byPayee.length > 1 && (
                <Panel title="By payee">
                  <ReportTableView table={waitingByPayeeTable(view.report)} />
                </Panel>
              )}
            </SideBySide>
            <WaitingList waiting={view.report} since="Approved" noun="payment" />
          </>
        ))}

      {view.section === "pipeline" && (
        <>
          <ReportTiles count={4}>
            <Tile
              label="Awaiting review"
              value={money(view.report.awaitingReview.amount)}
              hint={`${view.report.awaitingReview.count} waiting · oldest ${days(view.report.awaitingReview.oldestDays)}`}
            />
            <Tile
              label="Awaiting payment"
              value={money(view.report.awaitingPayment.amount)}
              hint={`${view.report.awaitingPayment.count} waiting · oldest ${days(view.report.awaitingPayment.oldestDays)}`}
            />
            <Tile
              label={`Decided in ${view.period.label}`}
              value={String(view.report.decided.approved.count + view.report.decided.declined.count)}
              hint={`${view.report.decided.approved.count} approved · ${view.report.decided.declined.count} declined (${money(view.report.decided.declined.amount)})`}
            />
            <Tile
              label="Submitted to paid"
              value={view.report.submitToPayment.median === null ? "—" : `${view.report.submitToPayment.median} days`}
              hint="Median, for payments in the period"
            />
          </ReportTiles>
          <SideBySide>
            <Panel title="How long each step takes" subtitle="Calendar days, for decisions and payments made in the period">
              <ReportTableView table={timingTable(view.report)} />
            </Panel>
            {view.report.awaitingReview.count > 0 && <WaitingBands waiting={view.report.awaitingReview} noun="review" />}
          </SideBySide>
          {view.report.byMonth.length > 1 && (
            <Panel title="By month" subtitle="Medians, in days">
              <ReportTableView table={pipelineByMonthTable(view.report)} />
            </Panel>
          )}
          {view.report.awaitingReview.count === 0 ? (
            <AllClear>Nothing is waiting for review.</AllClear>
          ) : (
            <WaitingList waiting={view.report.awaitingReview} since="Submitted" noun="review" />
          )}
        </>
      )}
    </div>
  );
}

/** What is waiting, by how long. */
function WaitingBands({ waiting, noun }: { waiting: Waiting; noun: string }) {
  return (
    <Panel title={`How long they have waited for ${noun}`} subtitle="As of today">
      <ReportTableView table={waitingBandsTable(waiting)} />
    </Panel>
  );
}

/** Each one waiting, longest first, with its wait marked amber past a week and red past a fortnight. */
function WaitingList({ waiting, since, noun }: { waiting: Waiting; since: string; noun: string }) {
  return (
    <Panel
      title={`Awaiting ${noun}`}
      subtitle={`${waiting.count.toLocaleString("en-AU")} ${waiting.count === 1 ? "expense" : "expenses"} · longest waiting first`}
    >
      <ReportTableView table={waitingListTable(`Awaiting ${noun}`, since, waiting)} />
    </Panel>
  );
}

/**
 * Two short tables next to each other on a wide screen, one under the other
 * on a narrow one. A table of ages or of steps is a few rows of a few
 * columns: given a row of its own it left most of the page empty beside it.
 * Each keeps its own height, and one alone takes the row.
 */
function SideBySide({ children }: { children: React.ReactNode }) {
  return <div className="grid items-start gap-4 xl:grid-cols-2 xl:[&>:only-child]:col-span-2">{children}</div>;
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card min-w-0 p-[1.1rem]">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      {subtitle && <p className="mt-0.5 text-support text-ink/70">{subtitle}</p>}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="card px-4 py-6 text-center text-body text-ink/70">{children}</p>;
}

/** Nothing to list because nothing is waiting: said in a line, with a tick. */
function AllClear({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 card px-[1.1rem] py-4 text-body text-ink/70">
      <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-palm/15 text-[0.75rem] text-[#00702f]">
        ✓
      </span>
      {children}
    </p>
  );
}

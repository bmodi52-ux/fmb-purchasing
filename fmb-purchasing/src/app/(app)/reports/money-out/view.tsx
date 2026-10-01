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
      <ReportHeader report="money-out" user={user} basis={BASIS[view.section]} />

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-ink/10">
        <nav aria-label="Money out sections" className="tabs border-b-0">
          {MONEY_OUT_SECTIONS.map((s) => (
            <Link
              key={s.key}
              href={sectionHref(s.key)}
              aria-current={view.section === s.key ? "page" : undefined}
              className="tab"
            >
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="pb-2">
          <DownloadLinks href={exportHref} />
        </div>
      </div>

      <ReportFilterBar
        filters={periodCode ? ["period", "vendor"] : ["vendor"]}
        period={periodCode ?? undefined}
        today={today}
        earliest={earliest}
        options={{ vendors: view.vendorOptions }}
        selected={{ vendors: view.vendors }}
      />

      {view.section === "paid" && (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Paid" value={money(view.report.total)} hint={view.period.label} />
            <Tile label="Transfers" value={String(view.report.transfers.length)} hint="Payment runs, and expenses paid on their own" />
            <Tile label="Expenses paid" value={String(view.report.expenseCount)} />
            <Tile
              label="Not yet on a bank statement"
              value={money(view.report.unconfirmed.amount)}
              hint={`${view.report.unconfirmed.count} ${view.report.unconfirmed.count === 1 ? "expense" : "expenses"}`}
            />
          </dl>
          {view.report.transfers.length === 0 ? (
            <Empty>Nothing was paid in {view.period.label}.</Empty>
          ) : (
            <>
              <Panel title="Transfers" subtitle="Newest first">
                <ReportTableView table={transfersTable(view.report)} />
              </Panel>
              <Panel title="By payee">
                <ReportTableView table={paidByPayeeTable(view.report)} />
              </Panel>
              {view.report.byMonth.length > 1 && (
                <Panel title="By month">
                  <ReportTableView table={paidByMonthTable(view.report)} />
                </Panel>
              )}
            </>
          )}
        </>
      )}

      {view.section === "waiting" && <WaitingSection waiting={view.report} since="Approved" noun="payment" />}

      {view.section === "pipeline" && (
        <>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          </dl>
          <Panel title="How long each step takes" subtitle="Calendar days, for decisions and payments made in the period">
            <ReportTableView table={timingTable(view.report)} />
          </Panel>
          {view.report.byMonth.length > 1 && (
            <Panel title="By month" subtitle="Medians, in days">
              <ReportTableView table={pipelineByMonthTable(view.report)} />
            </Panel>
          )}
          <WaitingSection waiting={view.report.awaitingReview} since="Submitted" noun="review" />
        </>
      )}
    </div>
  );
}

/** What is waiting — for payment or for review — and for how long. */
function WaitingSection({ waiting, since, noun }: { waiting: Waiting; since: string; noun: string }) {
  if (waiting.count === 0) return <Empty>Nothing is waiting for {noun}.</Empty>;
  return (
    <>
      {noun === "payment" && (
        <dl className="grid gap-3 sm:grid-cols-3">
          <Tile label="Awaiting payment" value={money(waiting.amount)} />
          <Tile label="Expenses" value={String(waiting.count)} />
          <Tile label="Oldest" value={days(waiting.oldestDays)} hint="Since approval" />
        </dl>
      )}
      <Panel title={`How long they have waited for ${noun}`}>
        <ReportTableView table={waitingBandsTable(waiting)} />
      </Panel>
      <Panel title={`Awaiting ${noun}`} subtitle="Longest waiting first">
        <ReportTableView table={waitingListTable(`Awaiting ${noun}`, since, waiting)} />
      </Panel>
      {noun === "payment" && waiting.byPayee.length > 1 && (
        <Panel title="By payee">
          <ReportTableView table={waitingByPayeeTable(waiting)} />
        </Panel>
      )}
    </>
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

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h2 className="section-title text-ink">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-ink/50">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="card px-4 py-8 text-center text-sm text-ink/55">{children}</p>;
}

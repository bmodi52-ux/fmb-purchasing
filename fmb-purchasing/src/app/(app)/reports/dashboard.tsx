import Link from "next/link";
import { Suspense } from "react";
import type { CurrentUser } from "@/lib/auth/session";
import { userCan } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { earliestExpenseDate, todayIso } from "@/lib/periods-data";
import { loadDashboardNow, loadDashboardRange, type DashboardNow, type SpendFigure } from "@/lib/reporting/dashboard-data";
import { favouritesFirst, loadFavouriteReports } from "@/lib/reporting/favourites";
import { SECTIONS, buildHref } from "@/lib/reporting/query";
import { RANGE_PRESETS, resolveRange, type RangePreset } from "@/lib/reporting/range-presets";
import { DASHBOARD_KEY, findReport, reportNavFor } from "@/lib/reporting/registry";
import { loadSavedViews, sortViews } from "@/lib/saved-report-views";
import { MeasureKey } from "@/components/measure-key";
import { PeriodPicker } from "@/components/period-picker";
import { ReportTile } from "@/components/report-tile";
import { OverTimeChart, RankedBars, TrendChart } from "./dashboard-charts";
import { FavouriteStar } from "./favourite-star";
import { ReportNav } from "./report-nav";

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const plural = (n: number, word: string) => `${n.toLocaleString("en-AU")} ${n === 1 ? word : `${word}s`}`;

const GRAIN_WORD = { day: "by the day", week: "by the week", month: "by the month" } as const;

/**
 * The way in to Reports: how things stand today, what a chosen period looks
 * like, and the reports and saved views someone keeps to hand.
 *
 * Nothing here is counted afresh. Each figure is one a report already shows
 * (lib/reporting/dashboard) and links to that report, on the same period, so
 * the dashboard and the reports cannot tell different stories.
 *
 * Each part loads by itself and takes its place when it is ready, in a card
 * that already has its shape — the page never jumps, and one slow part does
 * not hold up the rest.
 */
export async function ReportsDashboard({ user, params }: { user: CurrentUser; params: Params }) {
  const today = todayIso();
  const admin = createAdminClient();
  const { preset, period } = resolveRange(params, today);
  const by = one(params.by) === "item" ? "item" : "category";

  const canBudgets = await userCan(user, "budgets", "view");
  // Started once and read by two parts of the page: the figures along the
  // top, and the ageing of what is waiting further down.
  const now = loadDashboardNow(admin, today, canBudgets);
  const earliest = earliestExpenseDate(admin);

  const presetHref = (key: RangePreset) => {
    const q = new URLSearchParams({ range: key });
    if (key === "custom") q.set("period", period.code);
    if (by === "item") q.set("by", "item");
    return `/reports?${q}`;
  };
  const byHref = (next: "category" | "item") => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (key !== "by" && typeof value === "string") q.set(key, value);
    }
    if (next === "item") q.set("by", "item");
    const qs = q.toString();
    return qs ? `/reports?${qs}` : "/reports";
  };

  return (
    <div className="flex flex-col gap-6">
      <ReportNav active={DASHBOARD_KEY} user={user} />
      <div>
        <h1 className="page-title">Reports</h1>
        <MeasureKey measures={["spend", "outstanding", "paid"]} basis="By receipt date · submitted, approved and paid" />
      </div>

      <Suspense fallback={<KpiFallback withBudget={canBudgets} />}>
        <KpiRow now={now} canBudgets={canBudgets} />
      </Suspense>

      <section aria-labelledby="period-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <h2 id="period-heading" className="section-title text-ink">
              Over a period
            </h2>
            <p className="mt-0.5 text-support text-ink/70">{period.label}</p>
          </div>
          <nav aria-label="Date range" className="flex flex-wrap gap-1.5">
            {RANGE_PRESETS.map((p) => (
              <Link
                key={p.key}
                href={presetHref(p.key)}
                aria-current={preset === p.key ? "true" : undefined}
                className={`rounded-full px-3.5 py-2 text-support transition-colors ${
                  preset === p.key
                    ? "bg-gold/25 text-ink ring-1 ring-gold/50"
                    : "border border-ink/15 text-ink/70 hover:border-ink/30 hover:text-ink"
                }`}
              >
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
        {preset === "custom" && (
          <div className="card p-3">
            <Suspense fallback={<p className="text-body text-ink/60">Loading the period picker…</p>}>
              <CustomPeriod code={period.code} today={today} earliest={earliest} />
            </Suspense>
          </div>
        )}

        {/* Keyed by what it shows, so choosing another range shows the
            loading state again rather than the old charts under a new label. */}
        <Suspense key={`${period.code}:${by}`} fallback={<ChartsFallback />}>
          <PeriodCharts period={period} by={by} today={today} byHref={{ category: byHref("category"), item: byHref("item") }} />
        </Suspense>
      </section>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Suspense fallback={<CardFallback title="Awaiting payment, by how long" />}>
          <AwaitingCard now={now} />
        </Suspense>
        <Suspense fallback={<CardFallback title="Your reports" />}>
          <ReportsCard user={user} />
        </Suspense>
        <Suspense fallback={<CardFallback title="Saved views" className={LAST_OF_THREE} />}>
          <SavedViewsCard user={user} />
        </Suspense>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Today                                                               */
/* ------------------------------------------------------------------ */

async function KpiRow({ now, canBudgets }: { now: Promise<DashboardNow>; canBudgets: boolean }) {
  const { month, year, financialYear, overdue, awaiting, budget } = await now;
  const spendingHref = (code: string) => `/reports/spending?period=${encodeURIComponent(code)}`;

  return (
    <section aria-label="Today" className={`grid gap-3 sm:grid-cols-2 ${canBudgets ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
      <ReportTile label="Spend this month" value={money(month.spend)} href={spendingHref(month.code)}>
        <span>
          {plural(month.expenses, "expense")} · {month.label}
        </span>
        <Change figure={month} />
      </ReportTile>

      <ReportTile label="Spend this year" value={money(year.spend)} href={spendingHref(year.code)}>
        <span>{year.label}</span>
        <Change figure={year} />
        <span>
          {financialYear.label}: {money(financialYear.spend)}
        </span>
      </ReportTile>

      <ReportTile
        label="Overdue payables"
        value={money(overdue.amount)}
        tone={overdue.count > 0 ? "danger" : "normal"}
        dot={overdue.count > 0 ? "alert" : "good"}
        href="/reports/money-out?section=waiting"
      >
        {overdue.count > 0 ? (
          <span>
            <strong>{plural(overdue.count, "expense")}</strong> approved more than {plural(overdue.afterDays, "day")} ago · oldest{" "}
            {plural(overdue.oldestDays ?? 0, "day")}
          </span>
        ) : (
          <span>Nothing approved more than {plural(overdue.afterDays, "day")} ago is unpaid.</span>
        )}
        <span>
          {awaiting.count > 0 ? `${money(awaiting.amount)} awaiting payment in all (${awaiting.count})` : "Nothing is awaiting payment."}
        </span>
      </ReportTile>

      {budget && (
        <ReportTile
          label="Budget used"
          value={budget.used === null ? "No budget" : `${Math.round(budget.used * 100)}%`}
          tone={budget.used === null ? "muted" : budget.used > 1 ? "danger" : "normal"}
          meter={budget.used ?? undefined}
          href={`/budgets?period=${encodeURIComponent(budget.code)}`}
        >
          {budget.used === null ? (
            <span>No budgets are set for {budget.yearLabel}.</span>
          ) : (
            <span>
              <strong>{(budget.remaining ?? 0) < 0 ? `${money(-(budget.remaining ?? 0))} over` : `${money(budget.remaining ?? 0)} left`}</strong> of{" "}
              {money(budget.budgeted)} · {budget.yearLabel}
            </span>
          )}
        </ReportTile>
      )}
    </section>
  );
}

/**
 * The change against the same stretch of the period before. No red or green:
 * spending more is not in itself bad, so direction is an arrow and a name.
 */
function Change({ figure }: { figure: Pick<SpendFigure, "change" | "against"> }) {
  if (figure.change === null) return <span>Nothing in {figure.against} to compare with</span>;
  const up = figure.change > 0;
  return (
    <span>
      <strong>
        <span aria-hidden="true">{up ? "↑" : figure.change < 0 ? "↓" : "→"}</span> {Math.abs(Math.round(figure.change * 100))}%
      </strong>{" "}
      {up ? "more than" : figure.change < 0 ? "less than" : "the same as"} {figure.against}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* A period                                                            */
/* ------------------------------------------------------------------ */

async function CustomPeriod({ code, today, earliest }: { code: string; today: string; earliest: Promise<string | null> }) {
  return <PeriodPicker value={code} today={today} earliest={await earliest} />;
}

async function PeriodCharts({
  period,
  by,
  today,
  byHref,
}: {
  period: Awaited<ReturnType<typeof loadDashboardRange>>["period"];
  by: "category" | "item";
  today: string;
  byHref: { category: string; item: string };
}) {
  const range = await loadDashboardRange(period, by, today);
  const spendingHref = (patch: Parameters<typeof buildHref>[1]) =>
    buildHref(
      { period: period.code, section: "overview", status: "spend", vendors: [], categories: [], items: [], breakdownBy: "category", compareBy: "item" },
      patch
    );

  if (range.expenses === 0) {
    return (
      <p className="card px-4 py-8 text-center text-body text-ink/70">
        Nothing recorded for {period.label}. Choose another range above, or{" "}
        <Link href="/submit" className="underline underline-offset-2">
          submit an expense
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ChartCard
        className="md:col-span-2"
        title="Spend over time"
        subtitle={`${money(range.spend)} · ${plural(range.expenses, "expense")} · ${GRAIN_WORD[range.trend.grain]}`}
        link={{ href: spendingHref({}), label: "Open in Spending" }}
      >
        <TrendChart points={range.trend.points} label={`Spend over ${period.label}, ${GRAIN_WORD[range.trend.grain]}`} />
        {range.change !== null && (
          <p className="mt-3 text-support text-ink/70 [&_strong]:font-semibold [&_strong]:text-ink">
            <Change figure={range} />
          </p>
        )}
      </ChartCard>

      <ChartCard
        title="Top 10 categories"
        subtitle="By spend"
        link={{ href: spendingHref({ section: "breakdown", breakdownBy: "category" }), label: "All categories" }}
      >
        {range.topCategories.length ? <RankedBars data={range.topCategories} total={range.spend} /> : <Empty>No lines have a category in this period.</Empty>}
      </ChartCard>

      <ChartCard
        title="Top 10 items"
        subtitle="By spend"
        link={{ href: spendingHref({ section: "breakdown", breakdownBy: "item" }), label: "All items" }}
      >
        {range.topItems.length ? <RankedBars data={range.topItems} total={range.spend} /> : <Empty>No lines are matched to an item in this period.</Empty>}
      </ChartCard>

      <ChartCard
        className="md:col-span-2"
        title={by === "item" ? "Spend by item, over time" : "Spend by category, over time"}
        subtitle="The largest named; the rest together"
        link={{ href: spendingHref({ section: "breakdown", breakdownBy: by }), label: "Open Breakdown" }}
        control={
          <div className="segmented" role="group" aria-label="Split by">
            <Link href={byHref.category} aria-current={by === "category" ? "true" : undefined} className="segment" scroll={false}>
              Categories
            </Link>
            <Link href={byHref.item} aria-current={by === "item" ? "true" : undefined} className="segment" scroll={false}>
              Items
            </Link>
          </div>
        }
      >
        {range.overTime.months.length ? (
          <OverTimeChart months={range.overTime.months} series={range.overTime.series} />
        ) : (
          <Empty>Nothing to split in this period.</Empty>
        )}
      </ChartCard>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  link,
  control,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  link?: { href: string; label: string };
  control?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`card p-[1.1rem] ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-support text-ink/70">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {control}
          {link && (
            <Link href={link.href} className="text-support whitespace-nowrap text-brand underline underline-offset-[3px]">
              {link.label}
            </Link>
          )}
        </div>
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-4 text-body text-ink/70">{children}</p>;
}

/* ------------------------------------------------------------------ */
/* What is waiting                                                     */
/* ------------------------------------------------------------------ */

async function AwaitingCard({ now }: { now: Promise<DashboardNow> }) {
  const { awaiting, overdue } = await now;
  const largest = Math.max(...awaiting.bands.map((b) => b.amount), 0);

  return (
    <ChartCard
      title="Awaiting payment, by how long"
      subtitle={awaiting.count > 0 ? `${money(awaiting.amount)} · ${plural(awaiting.count, "expense")} · since approval` : "As of today"}
      link={{ href: "/reports/money-out?section=waiting", label: "Open" }}
    >
      {awaiting.count === 0 ? (
        <Empty>Nothing is waiting to be paid.</Empty>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {awaiting.bands.map((band) => (
            <li key={band.label}>
              <div className="flex items-baseline justify-between gap-3 text-body">
                <span>{band.label}</span>
                <span className="font-medium tabular-nums">
                  {band.count > 0 ? `${money(band.amount)} · ${band.count}` : "—"}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/[0.06]" aria-hidden="true">
                <div className="h-full rounded-full bg-brand" style={{ width: `${largest > 0 ? (band.amount / largest) * 100 : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {awaiting.count > 0 && (
        <p className="mt-3.5 text-support text-ink/70">
          Overdue is anything waiting more than {plural(overdue.afterDays, "day")} — when a payment reminder is escalated.
        </p>
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/* Kept to hand                                                        */
/* ------------------------------------------------------------------ */

async function ReportsCard({ user }: { user: CurrentUser }) {
  const [links, favourites] = await Promise.all([reportNavFor(user), loadFavouriteReports(createAdminClient(), user.id)]);
  const reports = favouritesFirst(
    links.filter((l) => l.key !== DASHBOARD_KEY),
    favourites
  );
  const starred = new Set(favourites);

  return (
    <ChartCard title="Your reports" subtitle={starred.size ? "Favourites first" : "Star the ones you use most"}>
      <ul className="flex flex-col divide-y divide-ink/5">
        {reports.map((r) => {
          const definition = findReport(r.key)!;
          return (
            <li key={r.key} className="flex items-start gap-1 py-2 first:pt-0 last:pb-0">
              <FavouriteStar reportKey={r.key} title={r.label} initial={starred.has(r.key)} />
              <Link href={r.href} className="group min-w-0 flex-1 pt-1">
                <span className="block text-body font-semibold text-ink underline-offset-[3px] group-hover:underline">{r.label}</span>
                <span className="mt-0.5 line-clamp-2 text-support text-ink/70" title={definition.description}>
                  {definition.description}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}

/** Three cards in two columns would leave the third alone in half the width: on a tablet it takes the row. */
const LAST_OF_THREE = "md:col-span-2 lg:col-span-1";

async function SavedViewsCard({ user }: { user: CurrentUser }) {
  const views = sortViews(await loadSavedViews(createAdminClient(), user), user.id);
  const shown = views.slice(0, 8);

  return (
    <ChartCard
      title="Saved views"
      className={LAST_OF_THREE}
      subtitle={views.length ? "Spending, set up the way you saved it" : undefined}
      link={{ href: "/reports/spending", label: views.length > shown.length ? `All ${views.length}` : "Manage" }}
    >
      {views.length === 0 ? (
        <Empty>
          No saved views yet. In{" "}
          <Link href="/reports/spending" className="underline underline-offset-2">
            Spending
          </Link>
          , set up a report and choose <strong className="font-medium text-ink/70">Saved views</strong> to keep it.
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-ink/5">
          {shown.map((v) => (
            <li key={v.id} className="py-2 first:pt-0 last:pb-0">
              <Link href={buildHref(v.query, {})} className="group block">
                <span className="text-body font-medium text-ink underline-offset-[3px] group-hover:underline">{v.name}</span>
                <span className="mt-0.5 block text-support text-ink/70">
                  {SECTIONS.find((s) => s.key === v.query.section)?.label ?? "Overview"}
                  {v.ownerId === user.id ? " · yours" : " · shared with you"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/* While it loads                                                      */
/* ------------------------------------------------------------------ */

/**
 * Loading states are the cards themselves, already in place and named, with
 * a quiet word inside — not grey bars, which on a wide screen read as a
 * broken page (see components/page-loading). They render once and keep
 * still, so nothing moves when the figures arrive.
 */
function KpiFallback({ withBudget }: { withBudget: boolean }) {
  const labels = ["Spend this month", "Spend this year", "Overdue payables", ...(withBudget ? ["Budget used"] : [])];
  return (
    <div role="status" aria-live="polite" className={`grid gap-3 sm:grid-cols-2 ${withBudget ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
      {labels.map((label) => (
        <ReportTile key={label} label={label} value="—" tone="muted" hint="Loading…" />
      ))}
    </div>
  );
}

function CardFallback({ title, className = "", tall = false }: { title: string; className?: string; tall?: boolean }) {
  return (
    <section role="status" aria-live="polite" className={`card p-[1.1rem] ${className}`}>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className={`flex items-center text-body text-ink/60 ${tall ? "h-[17rem]" : "h-24"}`}>Loading…</p>
    </section>
  );
}

function ChartsFallback() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <CardFallback title="Spend over time" className="md:col-span-2" tall />
      <CardFallback title="Top 10 categories" tall />
      <CardFallback title="Top 10 items" tall />
      <CardFallback title="Spend by category, over time" className="md:col-span-2" tall />
    </div>
  );
}
